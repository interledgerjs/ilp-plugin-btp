import { EventEmitter2 } from 'eventemitter2';
export interface WebSocketReconnectorConstructorOptions {
    interval?: number;
}
export declare class WebSocketReconnector extends EventEmitter2 {
    private _interval;
    private _url;
    private _instance;
    private _connected;
    constructor(options: WebSocketReconnectorConstructorOptions);
    open(url: string): void;
    send(data: any, cb?: (err: Error) => void): void;
    close(): void;
    private _reconnect(codeOrError);
}
