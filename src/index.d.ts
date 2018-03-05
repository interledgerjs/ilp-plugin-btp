/// <reference types="node" />
/// <reference types="ws" />
import * as WebSocket from 'ws';
import { DataHandler, MoneyHandler } from 'ilp-compat-plugin';
import { EventEmitter2 } from 'eventemitter2';
export interface BtpPacket {
    requestId: number;
    type: number;
    data: BtpPacketData;
}
export interface BtpPacketData {
    protocolData: Array<BtpSubProtocol>;
    amount?: string;
    code?: string;
    name?: string;
    triggeredAt?: Date;
    data?: string;
}
export interface BtpSubProtocol {
    protocolName: string;
    contentType: number;
    data: Buffer;
}
export interface IlpPluginBtpConstructorOptions {
    server?: string;
    listener?: {
        port: number;
        secret: string;
    };
    reconnectInterval?: number;
}
export interface ConnectDisconnectHandler {
    (): Promise<void>;
}
export default class AbstractBtpPlugin extends EventEmitter2 {
    version: number;
    protected _connect: ConnectDisconnectHandler;
    protected _disconnect: ConnectDisconnectHandler;
    private _reconnectInterval?;
    private _dataHandler?;
    private _moneyHandler?;
    private _connected;
    private _listener?;
    private _wss;
    private _incomingWs?;
    private _server?;
    private _ws?;
    constructor(options: IlpPluginBtpConstructorOptions);
    connect(): Promise<void>;
    _closeIncomingSocket(socket: WebSocket): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    _handleIncomingWsMessage(ws: WebSocket, binaryMessage: WebSocket.Data): Promise<void>;
    sendData(buffer: Buffer): Promise<Buffer>;
    sendMoney(): Promise<void>;
    _safeEmit(): void;
    registerDataHandler(handler: DataHandler): void;
    deregisterDataHandler(): void;
    registerMoneyHandler(handler: MoneyHandler): void;
    deregisterMoneyHandler(): void;
    protocolDataToIlpAndCustom(packet: BtpPacketData): {
        protocolMap: {};
        ilp: any;
        custom: any;
    };
    ilpAndCustomToProtocolData(obj: {
        ilp?: Buffer;
        custom?: Object;
        protocolMap?: Map<string, Buffer | string | Object>;
    }): BtpSubProtocol[];
    protected _call(to: string, btpPacket: BtpPacket): Promise<BtpPacketData>;
    protected _handleIncomingBtpPacket(from: string, btpPacket: BtpPacket): Promise<void>;
    protected _handleData(from: string, btpPacket: BtpPacket): Promise<Array<BtpSubProtocol>>;
    protected _handleMoney(from: string, btpPacket: BtpPacket): Promise<Array<BtpSubProtocol>>;
    protected _handleOutgoingBtpPacket(to: string, btpPacket: BtpPacket): Promise<void>;
}
export declare function _requestId(): Promise<number>;
