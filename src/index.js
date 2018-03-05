"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const crypto = require("crypto");
const Debug = require("debug");
const WebSocket = require("ws");
const ws_reconnect_1 = require("./ws-reconnect");
const eventemitter2_1 = require("eventemitter2");
const url_1 = require("url");
const protocol_data_converter_1 = require("./protocol-data-converter");
const BtpPacket = require('btp-packet');
const debug = Debug('ilp-plugin-btp');
const DEFAULT_TIMEOUT = 35000;
const namesToCodes = {
    'UnreachableError': 'T00',
    'NotAcceptedError': 'F00',
    'InvalidFieldsError': 'F01',
    'TransferNotFoundError': 'F02',
    'InvalidFulfillmentError': 'F03',
    'DuplicateIdError': 'F04',
    'AlreadyRolledBackError': 'F05',
    'AlreadyFulfilledError': 'F06',
    'InsufficientBalanceError': 'F07'
};
function jsErrorToBtpError(e) {
    const name = e.name || 'NotAcceptedError';
    const code = namesToCodes[name] || 'F00';
    return {
        code,
        name,
        triggeredAt: new Date(),
        data: JSON.stringify({ message: e.message })
    };
}
var BtpConstants;
(function (BtpConstants) {
    BtpConstants.TYPE_RESPONSE = 1;
    BtpConstants.TYPE_ERROR = 2;
    BtpConstants.TYPE_MESSAGE = 6;
    BtpConstants.TYPE_TRANSFER = 7;
    BtpConstants.MIME_APPLICATION_OCTET_STREAM = 0;
    BtpConstants.MIME_TEXT_PLAIN_UTF8 = 1;
    BtpConstants.MIME_APPLICATION_JSON = 2;
})(BtpConstants || (BtpConstants = {}));
class AbstractBtpPlugin extends eventemitter2_1.EventEmitter2 {
    constructor(options) {
        super();
        this.version = 2;
        this._reconnectInterval = options.reconnectInterval;
        this._connected = false;
        this._listener = options.listener;
        this._server = options.server;
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._connected) {
                return;
            }
            if (this._listener) {
                const wss = this._wss = new WebSocket.Server({ port: this._listener.port });
                this._incomingWs = undefined;
                wss.on('connection', (socket) => {
                    debug('got connection');
                    let authPacket;
                    let token;
                    socket.on('close', (code) => {
                        debug('incoming websocket closed. code=' + code);
                    });
                    socket.on('error', (err) => {
                        debug('incoming websocket error. error=', err);
                    });
                    socket.once('message', (data) => __awaiter(this, void 0, void 0, function* () {
                        try {
                            authPacket = BtpPacket.deserialize(data);
                            debug('got auth packet. packet=%j', authPacket);
                            assert(authPacket.type === BtpPacket.TYPE_MESSAGE, 'First message sent over BTP connection must be auth packet');
                            assert(authPacket.data.protocolData.length >= 2, 'Auth packet must have auth and auth_token subprotocols');
                            assert(authPacket.data.protocolData[0].protocolName === 'auth', 'First subprotocol must be auth');
                            for (let subProtocol of authPacket.data.protocolData) {
                                if (subProtocol.protocolName === 'auth_token') {
                                    token = subProtocol.data.toString();
                                    if (token !== this._listener.secret) {
                                        debug(JSON.stringify(token), JSON.stringify(this._listener.secret));
                                        throw new Error('invalid auth_token');
                                    }
                                    if (this._incomingWs) {
                                        this._closeIncomingSocket(this._incomingWs);
                                    }
                                    this._incomingWs = socket;
                                }
                            }
                            assert(token, 'auth_token subprotocol is required');
                            socket.send(BtpPacket.serializeResponse(authPacket.requestId, []));
                        }
                        catch (err) {
                            this._incomingWs = undefined;
                            if (authPacket) {
                                const errorResponse = BtpPacket.serializeError({
                                    code: 'F00',
                                    name: 'NotAcceptedError',
                                    data: err.message,
                                    triggeredAt: new Date().toISOString()
                                }, authPacket.requestId, []);
                                socket.send(errorResponse);
                            }
                            socket.close();
                            return;
                        }
                        debug('connection authenticated');
                        socket.on('message', this._handleIncomingWsMessage.bind(this, socket));
                        this.emit('_connect');
                    }));
                });
            }
            if (this._server) {
                const parsedBtpUri = new url_1.URL(this._server);
                const account = parsedBtpUri.username;
                const token = parsedBtpUri.password;
                if (!parsedBtpUri.protocol.startsWith('btp+')) {
                    throw new Error('server must start with "btp+". server=' + this._server);
                }
                this._ws = new ws_reconnect_1.WebSocketReconnector({ interval: this._reconnectInterval });
                const protocolData = [{
                        protocolName: 'auth',
                        contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
                        data: Buffer.from([])
                    }, {
                        protocolName: 'auth_username',
                        contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
                        data: Buffer.from(account, 'utf8')
                    }, {
                        protocolName: 'auth_token',
                        contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
                        data: Buffer.from(token, 'utf8')
                    }];
                this._ws.on('open', () => __awaiter(this, void 0, void 0, function* () {
                    debug('connected to server');
                    yield this._call('', {
                        type: BtpConstants.TYPE_MESSAGE,
                        requestId: yield _requestId(),
                        data: { protocolData }
                    });
                    this.emit('_connect');
                }));
                this._ws.on('message', this._handleIncomingWsMessage.bind(this, this._ws));
                parsedBtpUri.username = '';
                parsedBtpUri.password = '';
                const wsUri = parsedBtpUri.toString().substring('btp+'.length);
                yield this._ws.open(wsUri);
            }
            yield new Promise((resolve, reject) => {
                this.once('_connect', resolve);
                this.once('disconnect', () => void reject(new Error('connection aborted')));
            });
            if (this._connect) {
                yield this._connect();
            }
            this._connected = true;
            this.emit('connect');
        });
    }
    _closeIncomingSocket(socket) {
        return __awaiter(this, void 0, void 0, function* () {
            socket.removeAllListeners();
            socket.once('message', (data) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const authPacket = BtpPacket.deserialize(data);
                    socket.send(BtpPacket.serializeError({
                        code: 'F00',
                        name: 'NotAcceptedError',
                        data: 'This connection has been ended because the user has opened a new connection',
                        triggeredAt: new Date().toISOString()
                    }, authPacket.requestId, []));
                }
                catch (e) {
                    debug('error responding on closed socket', e);
                }
                socket.close();
            }));
        });
    }
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            this.emit('disconnect');
            if (this._disconnect) {
                yield this._disconnect();
            }
            if (this._ws)
                this._ws.close();
            if (this._incomingWs) {
                this._incomingWs.close();
                this._incomingWs = undefined;
            }
            if (this._wss)
                this._wss.close();
        });
    }
    isConnected() {
        return this._connected;
    }
    _handleIncomingWsMessage(ws, binaryMessage) {
        return __awaiter(this, void 0, void 0, function* () {
            let btpPacket;
            try {
                btpPacket = BtpPacket.deserialize(binaryMessage);
            }
            catch (err) {
                debug('deserialization error:', err);
                ws.close();
                return;
            }
            debug(`processing btp packet ${JSON.stringify(btpPacket)}`);
            try {
                yield this._handleIncomingBtpPacket('', btpPacket);
            }
            catch (err) {
                debug(`Error processing BTP packet of type ${btpPacket.type}: `, err);
                const error = jsErrorToBtpError(err);
                const requestId = btpPacket.requestId;
                const { code, name, triggeredAt, data } = error;
                yield this._handleOutgoingBtpPacket('', {
                    type: BtpConstants.TYPE_ERROR,
                    requestId,
                    data: {
                        code,
                        name,
                        triggeredAt,
                        data,
                        protocolData: []
                    }
                });
            }
        });
    }
    sendData(buffer) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this._call('', {
                type: BtpPacket.TYPE_MESSAGE,
                requestId: yield _requestId(),
                data: { protocolData: [{
                            protocolName: 'ilp',
                            contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
                            data: buffer
                        }] }
            });
            const ilpResponse = response.protocolData
                .filter(p => p.protocolName === 'ilp')[0];
            return ilpResponse
                ? ilpResponse.data
                : Buffer.alloc(0);
        });
    }
    sendMoney() {
        return __awaiter(this, void 0, void 0, function* () {
        });
    }
    _safeEmit() {
        try {
            this.emit.apply(this, arguments);
        }
        catch (err) {
            const errInfo = (typeof err === 'object' && err.stack) ? err.stack : String(err);
            debug('error in handler for event', arguments, errInfo);
        }
    }
    registerDataHandler(handler) {
        if (this._dataHandler) {
            throw new Error('requestHandler is already registered');
        }
        if (typeof handler !== 'function') {
            throw new Error('requestHandler must be a function');
        }
        debug('registering data handler');
        this._dataHandler = handler;
    }
    deregisterDataHandler() {
        this._dataHandler = undefined;
    }
    registerMoneyHandler(handler) {
        if (this._moneyHandler) {
            throw new Error('requestHandler is already registered');
        }
        if (typeof handler !== 'function') {
            throw new Error('requestHandler must be a function');
        }
        debug('registering money handler');
        this._moneyHandler = handler;
    }
    deregisterMoneyHandler() {
        this._moneyHandler = undefined;
    }
    protocolDataToIlpAndCustom(packet) {
        return protocol_data_converter_1.protocolDataToIlpAndCustom(packet);
    }
    ilpAndCustomToProtocolData(obj) {
        return protocol_data_converter_1.ilpAndCustomToProtocolData(obj);
    }
    _call(to, btpPacket) {
        return __awaiter(this, void 0, void 0, function* () {
            const requestId = btpPacket.requestId;
            let callback;
            let timer;
            const response = new Promise((resolve, reject) => {
                callback = (type, data) => {
                    switch (type) {
                        case BtpPacket.TYPE_RESPONSE:
                            resolve(data);
                            clearTimeout(timer);
                            break;
                        case BtpPacket.TYPE_ERROR:
                            reject(new Error(JSON.stringify(data)));
                            clearTimeout(timer);
                            break;
                        default:
                            throw new Error('Unknown BTP packet type: ' + type);
                    }
                };
                this.once('__callback_' + requestId, callback);
            });
            yield this._handleOutgoingBtpPacket(to, btpPacket);
            const timeout = new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    this.removeListener('__callback_' + requestId, callback);
                    reject(new Error(requestId + ' timed out'));
                }, DEFAULT_TIMEOUT);
            });
            return Promise.race([
                response,
                timeout
            ]);
        });
    }
    _handleIncomingBtpPacket(from, btpPacket) {
        return __awaiter(this, void 0, void 0, function* () {
            const { type, requestId, data } = btpPacket;
            const typeString = BtpPacket.typeToString(type);
            debug(`received BTP packet (${typeString}, RequestId: ${requestId}): ${JSON.stringify(data)}`);
            let result;
            switch (type) {
                case BtpPacket.TYPE_RESPONSE:
                case BtpPacket.TYPE_ERROR:
                    this.emit('__callback_' + requestId, type, data);
                    return;
                case BtpPacket.TYPE_PREPARE:
                case BtpPacket.TYPE_FULFILL:
                case BtpPacket.TYPE_REJECT:
                    throw new Error('Unsupported BTP packet');
                case BtpPacket.TYPE_TRANSFER:
                    result = yield this._handleMoney(from, btpPacket);
                    break;
                case BtpPacket.TYPE_MESSAGE:
                    result = yield this._handleData(from, btpPacket);
                    break;
                default:
                    throw new Error('Unknown BTP packet type');
            }
            debug(`replying to request ${requestId} with ${JSON.stringify(result)}`);
            yield this._handleOutgoingBtpPacket(from, {
                type: BtpPacket.TYPE_RESPONSE,
                requestId,
                data: { protocolData: result || [] }
            });
        });
    }
    _handleData(from, btpPacket) {
        return __awaiter(this, void 0, void 0, function* () {
            const { requestId, data } = btpPacket;
            const { ilp, protocolMap } = protocol_data_converter_1.protocolDataToIlpAndCustom(data);
            if (!this._dataHandler) {
                throw new Error('no request handler registered');
            }
            const response = yield this._dataHandler(ilp);
            return protocol_data_converter_1.ilpAndCustomToProtocolData({ ilp: response });
        });
    }
    _handleMoney(from, btpPacket) {
        return __awaiter(this, void 0, void 0, function* () {
            throw new Error('No sendMoney functionality is included in this module');
        });
    }
    _handleOutgoingBtpPacket(to, btpPacket) {
        return __awaiter(this, void 0, void 0, function* () {
            const ws = this._ws || this._incomingWs;
            try {
                yield new Promise((resolve) => ws.send(BtpPacket.serialize(btpPacket), resolve));
            }
            catch (e) {
                debug('unable to send btp message to client: ' + e.message, 'btp packet:', JSON.stringify(btpPacket));
            }
        });
    }
}
exports.default = AbstractBtpPlugin;
function _requestId() {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            crypto.randomBytes(4, (err, buf) => {
                if (err)
                    reject(err);
                resolve(buf.readUInt32BE(0));
            });
        });
    });
}
exports._requestId = _requestId;
//# sourceMappingURL=index.js.map