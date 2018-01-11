'use strict'

const assert = require('assert')
const debug = require('debug')('ilp-plugin-btp')
const crypto = require('crypto')
const EventEmitter = require('events').EventEmitter
const URL = require('url').URL
const WebSocket = require('ws')
const WebSocketReconnector = require('./ws-reconnect')
const BtpPacket = require('btp-packet')

const { protocolDataToIlpAndCustom, ilpAndCustomToProtocolData } =
  require('./protocol-data-converter')
const { isPassCompromised } = require('./src/lib/util')

const DEFAULT_TIMEOUT = 35000
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
}

function jsErrorToBtpError (e) {
  const name = e.name || 'NotAcceptedError'
  const code = namesToCodes[name] || 'F00'

  return {
    code,
    name,
    triggeredAt: new Date(),
    data: JSON.stringify({ message: e.message })
  }
}

/** Abstract base class for building BTP-based ledger plugins.
 *
 * This class takes care of most of the work translating between BTP and the
 * ledger plugin interface (LPI).
 *
 * You need to implement:
 *
 * sendMoney (amount), handleMoney (from, btpPacket)
 *
 * The `from` field is set to null in all the methods here. It is present in
 * order to make it possible to write multi account plugins (plugins with an
 * internal connector which understand ILP).
 *
 * If any work must be done on disconnect, implement _disconnect instead of
 * overriding this.disconnect. This will ensure that the connection is cleaned
 * up properly.
 *
 * If any work must be done on connect, implement _connect. You can also
 * rewrite connect, but then disconnect and handleOutgoingBtpPacket should also
 * be overridden.
 *
 * Instead, you need to implement _handleOutgoingBtpPacket(to, btpPacket) which
 * returns a Promise. `to` is the ILP address of the destination peer and
 * `btpPacket` is the BTP packet as a JavaScript object.
 *
 * You can call _handleIncomingBtpPacket(from, btpPacket) to trigger all the
 * necessary LPI events in response to an incoming BTP packet. `from` is the
 * ILP address of the peer and `btpPacket` is the parsed BTP packet.
 */

class AbstractBtpPlugin extends EventEmitter {
  constructor ({ listener, server, reconnectInterval }) {
    super()

    this._reconnectInterval = reconnectInterval // optional
    this._dataHandler = null
    this._moneyHandler = null
    this._connected = false

    this._listener = listener
    this._server = server
  }

  async connect () {
    if (this._connected) {
      return
    }

    if (this._listener) {
      const wss = this._wss = new WebSocket.Server({ port: this._listener.port })
      this._incomingWs = null

      wss.on('connection', (ws) => {
        debug('got connection')
        let authPacket
        let token

        ws.once('message', async (binaryAuthMessage) => {
          try {
            authPacket = BtpPacket.deserialize(binaryAuthMessage)
            debug('got auth packet. packet=%j', authPacket)
            assert.equal(authPacket.type, BtpPacket.TYPE_MESSAGE, 'First message sent over BTP connection must be auth packet')
            assert(authPacket.data.protocolData.length >= 2, 'Auth packet must have auth and auth_token subprotocols')
            assert.equal(authPacket.data.protocolData[0].protocolName, 'auth', 'First subprotocol must be auth')
            for (let subProtocol of authPacket.data.protocolData) {
              if (subProtocol.protocolName === 'auth_token') {
                token = subProtocol.data.toString()
                if (token !== this._listener.secret) {
                  debug(JSON.stringify(token), JSON.stringify(this._listener.secret))
                  throw new Error('invalid auth_token')
                }

                if (this._incomingWs) {
                  this._closeIncomingSocket(this._incomingWs)
                }

                this._incomingWs = ws
              }
            }

            assert(token, 'auth_token subprotocol is required')
            ws.send(BtpPacket.serializeResponse(authPacket.requestId, []))
          } catch (err) {
            this._incomingWs = null
            if (authPacket) {
              const errorResponse = BtpPacket.serializeError({
                code: 'F00',
                name: 'NotAcceptedError',
                data: err.message,
                triggeredAt: new Date().toISOString()
              }, authPacket.requestId, [])
              ws.send(errorResponse)
            }
            ws.close()
            return
          }

          debug('connection authenticated')
          ws.on('message', this._handleIncomingWsMessage.bind(this, ws))
          this.emit('connect')
        })
      })
    }

    if (this._server) {
      const parsedServer = new URL(this._server)
      const host = parsedServer.host // TODO: include path
      const secret = parsedServer.password
      if (await isPassCompromised(secret)) throw new Error('Your password is compromised. Choose a strong, random password.')

      this._ws = new WebSocketReconnector({ interval: this._reconnectInterval })

      const protocolData = [{
        protocolName: 'auth',
        contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from([])
      }, {
        protocolName: 'auth_username',
        contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('', 'utf8')
      }, {
        protocolName: 'auth_token',
        contentType: BtpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from(secret, 'utf8')
      }]

      this._ws.on('open', async () => {
        debug('connected to server')
        await this._call(null, {
          type: BtpPacket.TYPE_MESSAGE,
          requestId: await _requestId(),
          data: { protocolData }
        })
        this.emit('connect')
      })

      this._ws.on('message', this._handleIncomingWsMessage.bind(this, this._ws))
      await this._ws.open('ws://' + host) // TODO: wss
    }

    await new Promise((resolve, reject) => {
      this.once('connect', resolve)
      this.once('disconnect', () =>
        void reject(new Error('connection aborted')))
    })

    if (this._connect) {
      await this._connect()
    }

    this._connected = true
  }

  async _closeIncomingSocket (socket) {
    socket.removeAllListeners()
    socket.once('message', () => {
      try {
        ws.send(BtpPacket.serializeError({
          code: 'F00',
          name: 'NotAcceptedError',
          data: 'This connection has been ended because the user has opened a new connection',
          triggeredAt: new Date().toISOString()
        }, authPacket.requestId, []))
      } catch (e) {
        debug('error responding on closed socket', e)
      }
      socket.close()
    })
  }

  async disconnect () {
    this.emit('disconnect')
    if (this._disconnect) {
      await this._disconnect()
    }

    if (this._ws) this._ws.close()
    if (this._incomingWs) {
      this._incomingWs.close()
      this._incomingWs = null
    }
    if (this._wss) this._wss.close()
  }

  isConnected () {
    return this._connected
  }

  async _handleIncomingWsMessage (ws, binaryMessage) {
    let btpPacket
    try {
      btpPacket = BtpPacket.deserialize(binaryMessage)
    } catch (err) {
      debug('deserialization error:', err)
      ws.close()
    }

    debug(`processing btp packet ${JSON.stringify(btpPacket)}`)
    try {
      await this._handleIncomingBtpPacket(null, btpPacket)
    } catch (err) {
      debug(`Error processing BTP packet of type ${btpPacket.type}: `, err)
      const error = jsErrorToBtpError(err)
      const requestId = btpPacket.requestId
      const { code, name, triggeredAt, data } = error

      await this._handleOutgoingBtpPacket(null, {
        type: BtpPacket.TYPE_ERROR,
        requestId,
        data: {
          code,
          name,
          triggeredAt,
          data,
          protocolData: []
        }
      })
    }
  }

  async sendData (buffer) {
    const response = await this._call(null, {
      type: BtpPacket.TYPE_MESSAGE,
      requestId: await _requestId(),
      data: { protocolData: [{
        protocolName: 'ilp',
        contentType: BtpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: buffer
      }] }
    })

    const ilpResponse = response.protocolData
      .filter(p => p.protocolName === 'ilp')[0]

    return ilpResponse
      ? ilpResponse.data
      : Buffer.alloc(0)
  }

  async sendMoney () {
    // With no underlying ledger, sendMoney is a no-op
  }

  // don't throw errors even if the event handler throws
  // this is especially important in plugins because
  // errors can prevent the balance from being updated correctly
  _safeEmit () {
    try {
      this.emit.apply(this, arguments)
    } catch (err) {
      const errInfo = (typeof err === 'object' && err.stack) ? err.stack : String(err)
      debug('error in handler for event', arguments, errInfo)
    }
  }

  async _call (to, btpPacket) {
    const requestId = btpPacket.requestId

    let callback
    const response = new Promise((resolve, reject) => {
      callback = (type, data) => {
        switch (type) {
          case BtpPacket.TYPE_RESPONSE:
            resolve(data)
            break

          case BtpPacket.TYPE_ERROR:
            reject(new Error(JSON.stringify(data)))
            break

          default:
            throw new Error('Unkown BTP packet type', data)
        }
      }
      this.once('__callback_' + requestId, callback)
    })

    await this._handleOutgoingBtpPacket(to, btpPacket)

    const timeout = new Promise((resolve, reject) =>
      setTimeout(() => {
        this.removeListener('__callback_' + requestId, callback)
        reject(new Error(requestId + ' timed out'))
      }, DEFAULT_TIMEOUT))

    return Promise.race([
      response,
      timeout
    ])
  }

  async _handleIncomingBtpPacket (from, btpPacket) {
    const {type, requestId, data} = btpPacket
    const typeString = BtpPacket.typeToString(type)

    debug(`received BTP packet (${typeString}, RequestId: ${requestId}): ${JSON.stringify(data)}`)
    let result
    switch (type) {
      case BtpPacket.TYPE_RESPONSE:
      case BtpPacket.TYPE_ERROR:
        this.emit('__callback_' + requestId, type, data)
        return
      case BtpPacket.TYPE_PREPARE:
      case BtpPacket.TYPE_FULFILL:
      case BtpPacket.TYPE_REJECT:
        throw new Error('Unsupported BTP packet')

      case BtpPacket.TYPE_TRANSFER:
        result = await this._handleMoney(from, btpPacket)
        break

      case BtpPacket.TYPE_MESSAGE:
        result = await this._handleData(from, btpPacket)
        break
    }

    debug(`replying to request ${requestId} with ${JSON.stringify(result)}`)
    await this._handleOutgoingBtpPacket(from, {
      type: BtpPacket.TYPE_RESPONSE,
      requestId,
      data: { protocolData: result || [] }
    })
  }

  async _handleData (from, {requestId, data}) {
    const { ilp, protocolMap } = protocolDataToIlpAndCustom(data)

    if (!this._dataHandler) {
      throw new Error('no request handler registered')
    }

    const response = await this._dataHandler(ilp)
    return ilpAndCustomToProtocolData({ ilp: response })
  }

  async _handleMoney (from, {requestId, data}) {
    throw new Error('No sendMoney functionality is included in this module')
  }

  registerDataHandler (handler) {
    if (this._dataHandler) {
      throw new Error('requestHandler is already registered')
    }

    if (typeof handler !== 'function') {
      throw new Error('requestHandler must be a function')
    }

    debug('registering data handler')
    this._dataHandler = handler
  }

  deregisterDataHandler () {
    this._dataHandler = null
  }

  registerMoneyHandler (handler) {
    if (this._moneyHandler) {
      throw new Error('requestHandler is already registered')
    }

    if (typeof handler !== 'function') {
      throw new Error('requestHandler must be a function')
    }

    debug('registering money handler')
    this._moneyHandler = handler
  }

  deregisterMoneyHandler () {
    this._moneyHandler = null
  }

  async _handleOutgoingBtpPacket (to, btpPacket) {
    const ws = this._ws || this._incomingWs

    try {
      await new Promise((resolve) => ws.send(BtpPacket.serialize(btpPacket), resolve))
    } catch (e) {
      debug('unable to send btp message to client: ' + e.message, 'btp packet:', JSON.stringify(btpPacket))
    }
  }

  protocolDataToIlpAndCustom (packet) {
    return protocolDataToIlpAndCustom(packet)
  }

  ilpAndCustomToProtocolData (obj) {
    return ilpAndCustomToProtocolData(obj)
  }
}

async function _requestId () {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(4, (err, buf) => {
      if (err) reject(err)
      resolve(buf.readUInt32BE(0))
    })
  })
}

AbstractBtpPlugin.version = 2
module.exports = AbstractBtpPlugin
