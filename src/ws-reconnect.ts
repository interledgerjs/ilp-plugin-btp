import * as WebSocket from 'ws'
const createLogger = require('ilp-logger')
import { EventEmitter2 } from 'eventemitter2'
const debug = createLogger('ilp-ws-reconnect')

const DEFAULT_RECONNECT_INTERVAL = 5000

/* Minimum constructor for websocket. Only includes the URL to which to
 * connect. */
export interface WebSocketConstructor {
  new (url: string): WebSocket
}

/* Add a reconnect interval to the WebSocketConstructor. */
export interface WebSocketReconnectorConstructorOptions {
  interval?: number
  WebSocket: WebSocketConstructor
}

/* Extend websocket with reconnect functionality. */
export class WebSocketReconnector extends EventEmitter2 {
  private _interval: number
  private _url: string
  private _instance: WebSocket
  private _connected: boolean
  private WebSocket: WebSocketConstructor
  
  /* Constructor for websocket reconnecter. It is just an event emitter with
   * added websocket functionality. */
  constructor (options: WebSocketReconnectorConstructorOptions) {
    super()
    this._interval = options.interval || DEFAULT_RECONNECT_INTERVAL
    this.WebSocket = options.WebSocket
  }
  
  /* Define a number of handlers. On open, emit an open event, on close or
   * error, try to reconnect depending on the code or error, on message, emit a
   * message event with the data. Return a promise which resolves when the
   * connection is successfully opened. */
  open (url: string) {
    this._url = url
    this._instance = new (this.WebSocket)(this._url)
    this._instance.on('open', () => void this.emit('open'))
    this._instance.on('close', (code: number, reason: string) => this._reconnect(code))
    this._instance.on('error', (err: Error) => this._reconnect(err))
    this._instance.on('message', (data: WebSocket.Data) => void this.emit('message', data))
    return new Promise((resolve) => void this.once('open', resolve))
  }

  // uses callback to match normal ws api
  send (data: any, cb?: (err: Error) => void): void {
    return this._instance.send(data, cb)
  }

  close () {
    this._instance.removeAllListeners()
    this.emit('close')
    this._instance.close()
  }

  /* Remove all listeners, wait for interval, then try to open again. */
  private _reconnect (codeOrError: number | Error) {
    debug.debug(`websocket disconnected with ${codeOrError}; reconnect in ${this._interval}`)
    this._connected = false
    this._instance.removeAllListeners()
    setTimeout(() => {
      void this.open(this._url)
    }, this._interval)
    this.emit('close')
  }
}
