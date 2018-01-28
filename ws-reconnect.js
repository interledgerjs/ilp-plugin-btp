const WebSocket = require('simple-websocket')
const debug = require('debug')('ilp-ws-reconnect')
const EventEmitter2 = require('eventemitter2')
const DEFAULT_RECONNECT_INTERVAL = 5000

class WebSocketReconnector extends EventEmitter2 {
  constructor ({ interval }) {
    super()
    this._interval = interval || 5000
  }

  open (url) {
    this._url = url
    this._instance = new WebSocket(this._url)
    this._instance.on('connect', () => void this.emit('connect'))
    this._instance.on('close', (err) => this._reconnect(err))
    this._instance.on('error', (err) => this._reconnect(err))
    this._instance.on('data', (data, flags) => void this.emit('data', data, flags))
  }

  send (data) {
    return this._instance.send(data)
  }

  _reconnect (code) {
    debug(`websocket disconnected with ${code}; reconnect in ${this._interval}`)
    this._connected = false
    this._instance.removeAllListeners()
    setTimeout(() => {
      this.open(this._url)
    }, this._interval)
  }

  destroy () {
    this._instance.removeAllListeners()
    return this._instance.destroy()
  }
}

module.exports = WebSocketReconnector
