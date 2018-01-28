const WebSocket = require('uws')
const debug = require('debug')('ilp-ws-reconnect')
const EventEmitter2 = require('eventemitter2')
const MAX_RECONNECT_INTERVAL = 5000
const RESET_INTERVAL = 5000

class WebSocketReconnector extends EventEmitter2 {
  constructor ({ interval }) {
    super()
  }

  open (url, delay = 0) {
    setTimeout(() => {
      delay = 0
    }, RESET_INTERVAL)

    this._url = url
    this._instance = new WebSocket(this._url)
    this._instance.on('open', () => void this.emit('open'))
    this._instance.on('close', (err) => this._reconnect(err, delay))
    this._instance.on('error', (err) => this._reconnect(err, delay))
    this._instance.on('message', (data, flags) => void this.emit('message', data, flags))
  }

  // uses callback to match normal ws api
  send (data, callback) {
    return this._instance.send(data, callback)
  }

  _reconnect (code, delay) {
    debug(`websocket disconnected with ${JSON.stringify(code)}; reconnect in ${delay}ms`)
    this._connected = false
    this._instance.removeAllListeners()
    setTimeout(() => {
      this.open(this._url, Math.min(
        MAX_RECONNECT_INTERVAL,
        Math.max(delay, 25) * 2))
    }, delay)
  }

  close () {
    this._instance.removeAllListeners()
    return this._instance.close()
  }
}

module.exports = WebSocketReconnector
