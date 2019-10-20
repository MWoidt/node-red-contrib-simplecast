module.exports = function(RED) {
    "use strict";
    const util = require('util');
    const Client = require("castv2-client").Client;
    const DefaultMediaReceiver = require("castv2-client").DefaultMediaReceiver;
    const Application = require('castv2-client').Application;
    const googletts = require("google-tts-api");

    function SimpleCast(config) {
        RED.nodes.createNode(this, config);

        // Settings
        this.name = config.name;
        this.host = config.host;

        // var
        this.client = null;
        this.dmrApp = null;


        let node = this;


        // Initialize status
        this.status({
            fill: "green",
            shape: "dot",
            text: "not connected"
        });


        //
        //  Global error handler
        //

        this.onError = function(error, done) {
            if (String(error).indexOf("EHOSTUNREACH") >= 0 || String(error).indexOf("Device timeout") >= 0) {
                node.client = null;
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "Host unreachable"
                });
                if (cnx_timeout === null) poll_cnx();
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: "error"
                });
            }

            if (done) {
                done(error);
            } else {
                node.error(error);
            }
        };


        ///
        //  Status handler
        //
        this.onStatus = function(error, status) {
            if (error) return node.onError(error);

            node.status({
                fill: "green",
                shape: "dot",
                text: "idle"
            });
            node.context().set("status", status);

            var v = -1;
            if (status && status.controlType) v = status.level;
            if (status && status.volume && status.volume.controlType) v = status.volume.level;
            if (v >= 0) node.context().set("volume", v);


            if (status) node.send({
                payload: status
            });
        };


        //
        //  Input
        //

        this.on('input', function(msg, send, done) {
            send = send || function() {
                node.send.apply(node, arguments)
            }

            if (node.client === null) node.onError(exception.message, done);

            // Validate incoming message
            if (typeof msg.payload === 'string' || msg.payload instanceof String) {
                if (msg.payload.match("MUTE|CLOSE|UNMUTE|GET_STATUS|VOL_INC|VOL_DEC|GET_VOLUME|STOP|STATUS|PAUSE")) msg.payload = {
                    type: msg.payload
                };
                else if (msg.payload == "NEXT") msg.payload = {
                    type: "QUEUE_UPDATE",
                    "jump": 1
                };
                else if (msg.payload == "PREV") msg.payload = {
                    type: "QUEUE_UPDATE",
                    "jump": -1
                };
                else if (msg.payload == "RWD") msg.payload = {
                    type: "SEEK_DELTA",
                    time: -10
                };
                else if (msg.payload == "FWD") msg.payload = {
                    type: "SEEK_DELTA",
                    time: 10
                };
                else if (msg.payload == "FRANCEINFO") msg.payload = {
                    type: "MEDIA",
                    media: {
                        url: "http://direct.franceinfo.fr/live/franceinfo-midfi.mp3"
                    }
                };
                else if (node.getContentType(msg.payload) != "unknow") {
                    msg.payload = {
                        type: "MEDIA",
                        media: {
                            url: msg.payload
                        }
                    };
                }
            } else if (msg.payload == null || typeof msg.payload !== "object") {
                msg.payload = {
                    type: "GET_STATUS"
                };
            }



            try {
                node.client.getAppAvailability(node.dmrApp.APP_ID, (getAppAvailabilityError, availability) => {
                    if (getAppAvailabilityError) {
                        return node.onError(getAppAvailabilityError, done);
                    }

                    // Only attempt to use the app if its available
                    if (!availability || !(node.dmrApp.APP_ID in availability) || availability[node.dmrApp.APP_ID] === false)
                        return node.onStatus(null, null);

                    // Get current sessions
                    node.client.getSessions((getSessionsError, sessions) => {
                        if (getSessionsError) return node.onError(getSessionsError, done);

                        let activeSession = sessions.find(session => session.appId === node.dmrApp.APP_ID);
                        if (activeSession) {

                            // Join active Application session
                            node.client.join(activeSession, node.dmrApp, (joinError, receiver) => {
                                if (joinError) return node.onError(joinError, done);

                                node.status({
                                    fill: "green",
                                    shape: "dot",
                                    text: "joined"
                                });
                                node.sendCastCommand(receiver, msg.payload, done);
                                if (done) {
                                    done();
                                }
                            });

                        } else {
                            // Launch new Application session
                            node.client.launch(node.dmrApp, (launchError, receiver) => {
                                if (launchError) return node.onError(launchError, done);

                                node.status({
                                    fill: "green",
                                    shape: "dot",
                                    text: "launched"
                                });
                                node.sendCastCommand(receiver, msg.payload, done);
                                if (done) {
                                    done();
                                }
                            });
                        }
                    });
                });

            } catch (exception) {
                node.onError(exception.message, done);
            }

            if (done) {
                done();
            }

        });



        //
        //  Close
        //

        this.on('close', function(removed, done) {
            if (removed) {
                // This node has been deleted
            } else {
                // This node is being restarted
            }
            done();
        });




        this.clientConnect = function() {
            try {
                if (node.client === null) {
                    // Setup client
                    node.client = new Client();
                    node.client.on("error", node.onError);
                }

                // Execute command
                let connectOptions = {
                    host: node.host
                };

                node.client.connect(connectOptions, () => {
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "connected"
                    });
                });

                node.dmrApp = DefaultMediaReceiver;
                clearTimeout(cnx_timeout);
                cnx_timeout = null;

            } catch (exception) {

                node.onError(exception.message);
                this.status({
                    fill: "red",
                    shape: "dot",
                    text: "cant connected"
                });
            }
            return;
        }



        //
        //  Build a media object
        //
        this.buildMediaObject = function(media) {
            let urlParts = media.url.split("/");
            let fileName = urlParts.slice(-1)[0].split("?")[0];
            return {
                contentId: media.url,
                contentType: media.contentType || node.getContentType(fileName),
                streamType: media.streamType || "BUFFERED",
                metadata: {
                    metadataType: 0,
                    title: media.title || fileName,
                    subtitle: null,
                    images: [{
                        url: media.image || "https://nodered.org/node-red-icon.png"
                    }]
                },
                textTrackStyle: media.textTrackStyle,
                tracks: media.tracks
            };
        };


        //
        //  Build a media queue object
        //
        this.buildMediaQueueObject = function(media) {
            let urlParts = media.url.split("/");
            let fileName = urlParts.slice(-1)[0].split("?")[0];

            return {
                autoplay: true,
                activeTrackIds: [],
                playbackDuration: 2,
                media: {
                    contentId: media.url,
                    contentType: media.contentType || node.getContentType(fileName),
                    streamType: media.streamType || "BUFFERED",
                    metadata: {
                        metadataType: 0,
                        title: media.title || fileName,
                        subtitle: null,
                        images: [{
                            url: media.image || "https://nodered.org/node-red-icon.png"
                        }]
                    },
                    textTrackStyle: media.textTrackStyle,
                    tracks: media.tracks
                }
            };
        };




        //
        //  Media command handler
        //
        this.sendMediaCommand = function(receiver, command) {
            // Check for load commands
            if (command.type === "MEDIA") {
                // Load or queue media command
                if (command.media) {
                    if (Array.isArray(command.media)) {
                        // Queue handling
                        let mediaOptions = command.media.options || {
                            startIndex: 0,
                            repeatMode: "REPEAT_OFF"
                        };
                        const queue = command.media.map(node.buildMediaQueueObject);
                        queue.preloadTime = command.media.length;

                        return receiver.queueLoad(
                            queue,
                            mediaOptions,
                            node.onStatus);
                    } else {
                        // Single media handling
                        let mediaOptions = command.media.options || {
                            autoplay: true
                        };
                        return receiver.load(
                            node.buildMediaObject(command.media),
                            mediaOptions,
                            node.onStatus);
                    }
                }
            } else if (command.type === "TTS") {
                // Text to speech
                if (command.text) {
                    let speed = command.speed || 1;
                    let language = command.language || "en";

                    // Get castable URL
                    return googletts(command.text, language, speed).then(url => {
                        let media = node.buildMediaObject({
                            url: url,
                            contentType: "audio/mp3",
                            title: command.title ? command.title : "tts"
                        });

                        receiver.load(
                            media, {
                                autoplay: true
                            },
                            node.onStatus);
                    }, reason => {
                        node.onError(reason);
                    });
                }
            } else {
                // Initialize media controller by calling getStatus first
                receiver.getStatus((statusError, status) => {
                    if (statusError) return node.onError(statusError);

                    // Theres not actually anything playing, exit gracefully
                    if (!status) return node.onStatus(null, status);


                    switch (command.type) {
                        case "PAUSE":
                            receiver.pause(node.onStatus);
                            return receiver.getStatus(node.onStatus);
                            break;

                        case "QUEUE_UPDATE":
                            receiver.queueUpdate(null, {
                                jump: command.jump
                            }, node.onStatus);
                            return receiver.getStatus(node.onStatus);
                            break;

                        case "QUEUE_NEXT":
                            receiver.queueUpdate(null, {
                                jump: 1
                            }, node.onStatus);
                            return receiver.getStatus(node.onStatus);
                            break;

                        case "QUEUE_PREV":
                            receiver.queueUpdate(null, {
                                jump: -1
                            }, node.onStatus);
                            return receiver.getStatus(node.onStatus);
                            break;

                        case "PLAY":
                            receiver.play(node.onStatus);
                            return receiver.getStatus(node.onStatus);
                            break;

                        case "SEEK":
                            receiver.seek(command.time, node.onStatus);
                            return receiver.getStatus(node.onStatus);
                            break;

                        case "SEEK_DELTA":
                            receiver.seek(status.currentTime + command.time, node.onStatus);
                            return receiver.getStatus(node.onStatus);
                            break;

                        case "STOP":
                            return receiver.stop(node.onStatus);
                            break;

                        case "STATUS":
                            return receiver.getStatus(node.onStatus);
                            break;
                    }

                    // Nothing executed, return the current status
                    return node.onError("Malformed media control command");
                });
            }
        };




        this.sendCastCommand = function(receiver, command, done) {
            node.status({
                fill: "yellow",
                shape: "dot",
                text: "sending"
            });

            // Check for platform commands first
            switch (command.type) {

                case "CLOSE":
                    return node.client.stop(receiver, (err, applications) => node.onStatus(err, null));
                    break;

                case "GET_VOLUME":
                    return node.client.getVolume(node.onStatus);
                    break;

                case "GET_STATUS":
                    return node.client.getStatus(node.onStatus);
                    break;

                case "MUTE":
                    return node.client.setVolume({
                        muted: true
                    }, node.onStatus);
                    break;

                case "UNMUTE":
                    return node.client.setVolume({
                        muted: false
                    }, node.onStatus);
                    break;

                case "VOLUME":
                    if (command.volume && command.volume >= 0 && command.volume <= 100) {
                        return node.client.setVolume({
                            level: command.volume / 100
                        }, node.onStatus);
                    }
                    break;

                case "VOL_INC":
                    var v = node.context().get("volume") || 0;

                    if (command.step) {
                        v = Math.min(1, v + (command.step / 100));
                        return node.client.setVolume({
                            level: v
                        }, node.onStatus);
                    } else {
                        v = Math.min(1, v + 0.1);
                        return node.client.setVolume({
                            level: v
                        }, node.onStatus);
                    }

                    break;

                case "VOL_DEC":
                    var v = node.context().get("volume") || 0;

                    if (command.step) {
                        v = Math.max(0, v - (command.step / 100));
                        return node.client.setVolume({
                            level: v
                        }, node.onStatus);
                    } else {
                        v = Math.max(0, v - 0.1);
                        return node.client.setVolume({
                            level: v
                        }, node.onStatus);
                    }

                    break;

                default:
                    // If media receiver attempt to execute media commands
                    if (receiver instanceof DefaultMediaReceiver) {
                        return node.sendMediaCommand(receiver, command);
                    }
                    break;
            }

            // If it got this far just error
            return node.onError("Malformed command");
        };



        //
        //  Get content type for a URL
        //
        this.getContentType = function(fileName) {
            const contentTypeMap = {
                aac: "video/mp4",
                aif: "audio/x-aiff",
                aiff: "audio/x-aiff",
                aifc: "audio/x-aiff",
                avi: "video/x-msvideo",
                au: "audio/basic",
                bmp: "image/bmp",
                flv: "video/x-flv",
                gif: "image/gif",
                ico: "image/x-icon",
                jpe: "image/jpeg",
                jpeg: "image/jpeg",
                jpg: "image/jpeg",
                m3u: "audio/x-mpegurl",
                m3u8: "application/x-mpegURL",
                m4a: "audio/mp4",
                mid: "audio/mid",
                midi: "audio/mid",
                mov: "video/quicktime",
                movie: "video/x-sgi-movie",
                mpa: "audio/mpeg",
                mp2: "audio/x-mpeg",
                mp3: "audio/mp3",
                mp4: "audio/mp4",
                mjpg: "video/x-motion-jpeg",
                mjpeg: "video/x-motion-jpeg",
                mpe: "video/mpeg",
                mpeg: "video/mpeg",
                mpg: "video/mpeg",
                ogg: "audio/ogg",
                ogv: "audio/ogg",
                png: "image/png",
                qt: "video/quicktime",
                ra: "audio/vnd.rn-realaudio",
                ram: "audio/x-pn-realaudio",
                rmi: "audio/mid",
                rpm: "audio/x-pn-realaudio-plugin",
                snd: "audio/basic",
                stream: "audio/x-qt-stream",
                svg: "image/svg",
                tif: "image/tiff",
                tiff: "image/tiff",
                vp8: "video/webm",
                wav: "audio/vnd.wav",
                webm: "video/webm",
                webp: "image/webp",
                wmv: "video/x-ms-wmv"
            };
            let ext = fileName.split(".").slice(-1)[0];
            let contentType = contentTypeMap[ext.toLowerCase()];
            return contentType || "unknow";
        };

        var cnx_timeout = null;

        function poll_cnx() {
            node.clientConnect();
            cnx_timeout = setTimeout(poll_cnx, 20000);
        }
        this.clientConnect();
    }

    RED.nodes.registerType("simplecast", SimpleCast);
}