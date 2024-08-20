const fpnn = require('./fpnn.js');
const msgpack = require('msgpack-lite');
const { Int64BE } = require('./libs/int64.min.js');

const RTVT_SDK_VERSION = "1.0.3";

const RTVT_ERROR_CODE = {
    RTVT_EC_TOKEN_INVALID: 300001,
    RTVT_EC_VOICE_LENGTH_ERROR: 300002,
    RTVT_EC_STREAM_ERROR: 300003,
};

function isException(isAnswerErr, data) {

    if (!data) {
        return new fpnn.FPError(fpnn.FPConfig.ERROR_CODE.FPNN_EC_PROTO_UNKNOWN_ERROR, Error('data is null'));
    }

    if (data instanceof Error) {
        let errorCode = fpnn.FPConfig.ERROR_CODE.FPNN_EC_PROTO_UNKNOWN_ERROR;
        if (data.code !== undefined) {
            errorCode = data.code;
        }
        return new fpnn.FPError(errorCode, data);
    }

    if (isAnswerErr) {
        if (data.hasOwnProperty('code') && data.hasOwnProperty('ex')) {
            return new fpnn.FPError(data.code, new Error(data.ex));
        }
    }

    return null;
}

function sendQuest(client, options, callback, timeout) {

    let self = this;

    if (!client) {
        callback && callback(new fpnn.FPError(fpnn.FPConfig.ERROR_CODE.FPNN_EC_CORE_INVALID_CONNECTION, Error('invalid connection')), null);
        return;
    }

    client.sendQuest(options, function(data) {
        
        if (!callback) {

            return;
        }

        let err = null;
        let isAnswerErr = false;

        if (data.payload) {

            let payload = msgpack.decode(data.payload, {
                codec: msgpack.createCodec({  
                    int64: true
                })
            });

            if (data.mtype == 2) {

                isAnswerErr = data.ss != 0;
            }

            err = isException.call(self, isAnswerErr, payload);

            if (err) {

                callback && callback(err, null);
                return;
            }

            callback && callback(null, payload);
            return;
        }

        err = isException.call(self, isAnswerErr, data);

        if (err) {

            callback && callback(err, null);
            return;
        }

        callback && callback(null, data);
    }, timeout);
}

class RTVTStream {
    constructor(options) {
        fpnn.FPEvent.assign(this);
        this._id = options.id;
        this._srcLang = options.srcLang;
        this._destLang = options.destLang;
        this._asrResult = options.asrResult;
        this._transResult = options.transResult;
        this._asrTempResult = options.asrTempResult;
        this._streamID = options.streamID;
        this._client = options.client;
    }

    getStreamID() {
        return this._streamID;
    }

    close(lastSeq) {
        var payload = {
            streamId: this._streamID,
        };

        if (lastSeq !== undefined) {
            payload[lastSeq] = lastSeq;
        }

        let options = {
            flag: 1,
            method: 'voiceEnd',
            payload: msgpack.encode(payload),
        };

        let self = this;
        sendQuest.call(this, this._client._client, options, function(err, data) {
            if (!err) {
                self._client._removeStream(self._id);
            }
        }, this._timeout);
    }
};

class RTVTClient {

    constructor(options) {
        fpnn.FPEvent.assign(this);

        this._endpoint = options.endpoint;
        this._pid = options.pid;
        this._uid = options.uid;
        this._timeout = options.timeout || 5 * 1000;
        this._canReconnect = false;
        this._reconnectInterval = 5000;

        this._streamIDSeq = 1;
        this._reconnectTimer = 0;
        this._lastReconnectTime = 0;
        this._streamMap = {};
        this._streamID2IDMap = {};

        this._lastPingTime = -1;
        this._pingTimers = 0;
        this._pingSeconds = 5;
        this._clientVersion = 0;

        this._sendBuffer = [];
        this._sendBufferMaxLimit = options.bufferLimit || 1000;
        this._sendingStatus = false;
    }

    login(token, ts, callback) {
        this._login(token, ts, callback);
    }

    destory() {
        this._canReconnect = false;
        this.stopAllStreams();
        this._client.close();
    }

    stopAllStreams() {
        for (var i in this._streamMap) {
            this._streamMap[i].close();
            delete this._streamMap[i];
        }
    }

    createStream(srcLang, destLang, asrResult, tempResult, transResult, callback, oldID) {
        let options = {
            flag: 1,
            method: 'voiceStart',
            payload: msgpack.encode({
                asrResult: asrResult,
                asrTempResult: tempResult,
                transResult: transResult,
                srcLanguage: srcLang,
                destLanguage: destLang,
            }),
        };

        let self = this;
        sendQuest.call(self, self._client, options, function(err, data) {
            if (!err) {

                var initOptions = {
                    srcLang: srcLang,
                    destLang: destLang,
                    asrResult: asrResult,
                    transResult: transResult,
                    asrTempResult: tempResult,
                    streamID: data.streamId,
                    client: self,
                };

                if (oldID === undefined) {
                    initOptions.id = self._streamIDSeq++;
                } else {
                    initOptions.id = oldID;
                }
                
                var stream = new RTVTStream(initOptions);

                if (oldID === undefined) {
                    self._streamMap[stream._id] = stream;
                    self._streamID2IDMap[stream._streamID.toString()] = stream._id;
                }
                if (callback) {
                    callback(stream, 0);
                }
            } else {
                callback && callback(null, err.code);
            }
        }, this._timeout);
    }

    sendVoice(stream, seq, data) {
        if (data.byteLength != 640) {
            return RTVT_ERROR_CODE.RTVT_EC_VOICE_LENGTH_ERROR;
        }

        if (this._streamMap[stream._id] === undefined) {
            return RTVT_ERROR_CODE.RTVT_EC_STREAM_ERROR;
        }

        var payload = {
            streamId: this._streamMap[stream._id]._streamID,
            seq: seq,
            data: data,
            ts: new Int64BE(parseInt('' + new Date().getTime())),
        };

        let options = {
            flag: 1,
            method: 'voiceData',
            payload: msgpack.encode(payload, {
                codec: msgpack.createCodec({  
                   
                    binarraybuffer: true,
                })
            }),

            ts: new Int64BE(parseInt('' + new Date().getTime())),
        };
        let self = this;
        let start = parseInt(new Date().getTime());
        sendQuest.call(this, this._client, options, function(err, data) {
            if (err) {
                self.emit('ErrorRecorder', err);

                if (err.code == 800001) {
                    self.onClose();
                }
            }
        }, self._timeout);
    }

    _removeStream(id) {
        delete this._streamMap[id];
    }

    _login(token, ts, callback) {
        this._token = token;
        this._ts = ts;
        this._client = new fpnn.FPClient({
            endpoint: this._endpoint + '/service/websocket',
            autoReconnect: false,
            connectionTimeout: 10 * 1000
        });
        this._client.clientVersion = this._clientVersion++;

        let self = this;
        this._client.events = {};
        this._client.on('connect', function() {
            let options = {
                flag: 1,
                method: 'login',
                payload: msgpack.encode({
                    pid: self._pid,
                    token: self._token,
                    ts: self._ts,
                    uid: self._uid,
                    version: RTVT_SDK_VERSION,
                }),
            };
    
            sendQuest.call(self, self._client, options, function(err, data) {
                if (data && data.successed === true) {
                    self._canReconnect = true;
                    callback && callback(true, fpnn.FPConfig.ERROR_CODE.FPNN_EC_OK);
                } else {
                    self._canReconnect = false;
                    callback && callback(false, 800001);
                }

                self._client.events = {};

                self._client.on('close', function() {
                    if (self.clientVersion == self._client.clientVersion) {
                        self.onClose();
                    } else {
                        self.emit('ErrorRecorder', "clientVersion not match");
                    }
                });
        
                self._client.on('error', function(err) {
                    self.emit('ErrorRecorder', err);
                });
            
                self._client.processor.on('recognizedResult', function(payload, cb) {

                    cb(msgpack.encode({}), false);

                    let data = msgpack.decode(payload, {codec: msgpack.createCodec({ 
                        int64: true
                    })});
                   
                    self.emit("recognizedResult", data);
                });

                self._client.processor.on('recognizedTempResult', function(payload, cb) {

                    cb(msgpack.encode({}), false);

                    let data = msgpack.decode(payload, {codec: msgpack.createCodec({ 
                        int64: true
                    })});
                   
                    self.emit("recognizedTempResult", data);
                });
        
                self._client.processor.on('translatedResult', function(payload, cb) {

                    cb(msgpack.encode({}), false);

                    let data = msgpack.decode(payload, {codec: msgpack.createCodec({ 
                        int64: true
                    })});

                    self.emit("translatedResult", data);
                });

                self._client.processor.on('translatedTempResult', function(payload, cb) {

                    cb(msgpack.encode({}), false);

                    let data = msgpack.decode(payload, {codec: msgpack.createCodec({ 
                        int64: true
                    })});

                    self.emit("translatedTempResult", data);
                });

                if (self._pingTimers != 0) {
                    clearTimeout(self._pingTimers);
                }

                self._pingTimers = setTimeout(function() {
                    self._updatePingTime();
                }, self._pingSeconds * 1000);

            }, this._timeout);
        });

        this._client.connect();
    }

    _updatePingTime() {
        let options = {
            flag: 1,
            method: '*ping',
            payload: msgpack.encode({}),
        };

        let self = this;
        sendQuest.call(this, this._client, options, function(err, data) {
            let now = parseInt(new Date().getTime()) / 1000;
            if (!err) {
                self._lastPingTime = now;
            }

            if (self._lastPingTime != -1 && now - self._lastPingTime >= 5) {
                self.onClose();
            } else {
                if (self._pingTimers != 0) {
                    clearTimeout(self._pingTimers);
                }

                self._pingTimers = setTimeout(function() {
                    self._updatePingTime();
                }, self._pingSeconds * 1000);
            }
        }, 2000);
    }

    onClose() {
        if (!this._canReconnect) {
            this.emit('SessionClosed', fpnn.FPConfig.ERROR_CODE.FPNN_EC_CORE_CONNECTION_CLOSED);
            return;
        }

        var interval = 0;
        let now = parseInt(new Date().getTime());
        if (this._lastReconnectTime > 0 && now - this._lastReconnectTime < 1000) {
            interval = this._reconnectInterval - now + this._lastReconnectTime;
        }
        if (interval < 5000) {
            interval = 5000;
        }

        let self = this;
        this._reconnectTimer = setTimeout(function() {
            self._lastReconnectTime = parseInt(new Date().getTime());
            self._login(self._token, self._ts, function(ok, errorCode) {
                if (ok) {
                    let oldCount = Object.keys(self._streamMap).length;
                    if (oldCount > 0) {
                        var newStreamMap = {};
                        var recoverNum = 0;
                        for (var i in self._streamMap) {
                            let oldStream = self._streamMap[i];
                            self.createStream(oldStream._srcLang, oldStream._destLang, oldStream._asrResult, oldStream._asrTempResult, oldStream._transResult, function(stream, errorCode) {
                                if (stream === undefined || stream === null) {
                                    self.emit('ErrorRecorder', "recover stream error: " + errorCode);
                                    return;
                                }

                                newStreamMap[stream._id] = stream;

                                if (++recoverNum >= oldCount) {
                                    var sids = {};
                                    for (var id in newStreamMap) {
                                        sids[newStreamMap[id]._streamID.toString()] = 1;
                                        self._streamMap[id] = newStreamMap[id];
                                        self._streamID2IDMap[newStreamMap[id]._streamID.toString()] = newStreamMap[id]._id;
                                        self.emit('ErrorRecorder', "recover stream, streamID: " + newStreamMap[id]._streamID.toString() + ", ID: " + id);
                                    }

                                    for (var id in self._streamMap) {
                                        if (newStreamMap[id] === undefined) {
                                            delete self._streamID2IDMap[self._streamMap[id]._streamID.toString()];
                                            delete self._streamMap[id];
                                        }
                                    }

                                    for (var sid in self._streamID2IDMap) {
                                        if (sids[sid] == undefined) {
                                            delete self._streamID2IDMap[sid];
                                        }
                                    }

                                }
                            }, oldStream._id);
                        }
                    }

                    self._canReconnect = true;
                    self.emit('ReloginCompleted', true, 0);
                    return;
                }
                if (errorCode == 800101 || errorCode == 800103) {
                    self._canReconnect = false;
                    self.emit('SessionClosed', RTVT_ERROR_CODE.RTVT_EC_TOKEN_INVALID);
                    return;
                }
                self.emit('ReloginCompleted', false, errorCode);
                self.onClose();
            });
        }, interval);
    }
};

export {
    RTVTClient,
	RTVTStream,
	RTVT_ERROR_CODE,
};