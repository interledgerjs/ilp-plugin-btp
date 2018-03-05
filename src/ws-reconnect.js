"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WebSocket = require("ws");
const Debug = require("debug");
const eventemitter2_1 = require("eventemitter2");
const debug = Debug('ilp-ws-reconnect');
const DEFAULT_RECONNECT_INTERVAL = 5000;
class WebSocketReconnector extends eventemitter2_1.EventEmitter2 {
    constructor(options) {
        super();
        this._interval = options.interval || 5000;
    }
    open(url) {
        this._url = url;
        this._instance = new WebSocket(this._url);
        this._instance.on('open', () => void this.emit('open'));
        this._instance.on('close', (code, reason) => this._reconnect(code));
        this._instance.on('error', (err) => this._reconnect(err));
        this._instance.on('message', (data) => void this.emit('message', data));
    }
    send(data, cb) {
        return this._instance.send(data, cb);
    }
    close() {
        this._instance.removeAllListeners();
        return this._instance.close();
    }
    _reconnect(codeOrError) {
        debug(`websocket disconnected with ${codeOrError}; reconnect in ${this._interval}`);
        this._connected = false;
        this._instance.removeAllListeners();
        setTimeout(() => {
            this.open(this._url);
        }, this._interval);
    }
}
exports.WebSocketReconnector = WebSocketReconnector;
//# sourceMappingURL=ws-reconnect.js.map