import * as WebSocket from 'ws'
import * as Debug from 'debug'
import { EventEmitter2 } from 'eventemitter2'
const debug = Debug('ilp-ws-reconnect')

const DEFAULT_RECONNECT_INTERVAL = 5000

export interface WebSocketReconnectorConstructorOptions {
  interval?: number
}

export class WebSocketReconnector extends EventEmitter2 {

  private _interval: number
  private _url: string
  private _instance: WebSocket
  private _connected: boolean

  constructor (options: WebSocketReconnectorConstructorOptions) {
    super()
    this._interval = options.interval || 5000
  }

  open (url: string) {
    this._url = url
    this._instance = new WebSocket(this._url)
    this._instance.on('open', () => void this.emit('open'))
    this._instance.on('close', (code: number, reason: string) => this._reconnect(code))
    this._instance.on('error', (err: Error) => this._reconnect(err))
    this._instance.on('message', (data: WebSocket.Data) => void this.emit('message', data))
  }

  // uses callback to match normal ws api
  send (data: any, cb?: (err: Error) => void): void {
    return this._instance.send(data, cb)
  }

  close () {
    this._instance.removeAllListeners()
    return this._instance.close()
  }

  private _reconnect (codeOrError: number | Error) {
    debug(`websocket disconnected with ${codeOrError}; reconnect in ${this._interval}`)
    this._connected = false
    this._instance.removeAllListeners()
    setTimeout(() => {
      this.open(this._url)
    }, this._interval)
  }
}
