'use strict'

const btpPacket = require('btp-packet')
const assert = require('chai').assert

const ObjStore = require('./helpers/objStore')
const PluginPaymentChannel = require('..')
const MockSocket = require('./helpers/mockSocket')
const { protocolDataToIlpAndCustom } =
  require('../protocol-data-converter')

const options = {
  server: 'btp+wss://user:placeholder@example.com/rpc',
}

describe('Info', () => {
  beforeEach(async function () {
    options._store = new ObjStore()
    this.plugin = new PluginBtp(options)

    this.mockSocketIndex = 0
    this.mockSocket = new MockSocket()
    this.mockSocket
      .reply(btpPacket.TYPE_MESSAGE, ({ requestId }) => btpPacket.serializeResponse(requestId, []))

    this.plugin.connected = true
    this.plugin._ws = this.mockSocket
  })

  afterEach(async function () {
    assert(await this.mockSocket.isDone(), 'request handlers must have been called')
  })

  describe('authentication', () => {
    beforeEach(async function () {
      this.newSocket = new MockSocket()
      this.plugin.addSocket(this.newSocket)
    })

    afterEach(async function () {
      assert(await this.newSocket.isDone(), 'request handlers must be complete')
    })

    it('should deny an authentication request with wrong method', async function () {
      this.newSocket.emit('message', btpPacket.serializeFulfill({
        transferId: 'b38a5203-bdb8-f11f-db01-5a32cf1a4e43',
        fulfillment: 'Ndr_HMuLPPl0idUlvAXFXBVQTFOizq-nXozej0KIA7k'
      }, 100, []))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"invalid method on unauthenticated socket"}')
      })
    })

    it('should deny an authentication request with no "auth" protocol', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, []))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"auth must be primary protocol on unauthenticated message"}')
      })
    })

    it('should deny an authentication request with no "auth_token" protocol', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"missing \\"auth_token\\" secondary protocol"}')
      })
    })

    it('should deny an authentication request with no "auth_username" protocol', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }, {
        protocolName: 'auth_token',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F01')
        assert.equal(e.data.name, 'InvalidFieldsError')
        assert.equal(e.data.data, '{"message":"missing \\"auth_username\\" secondary protocol"}')
      })
    })

    it('should deny an authentication request with invalid token', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }, {
        protocolName: 'auth_token',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('garbage')
      }, {
        protocolName: 'auth_username',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_ERROR, e => {
        assert.equal(e.requestId, 100)
        assert.equal(e.data.code, 'F00')
        assert.equal(e.data.name, 'NotAcceptedError')
        assert.equal(e.data.data, '{"message":"invalid auth token and/or username"}')
      })
    })

    it('should accept an authentication request with valid credentials', async function () {
      this.newSocket.emit('message', btpPacket.serializeMessage(100, [{
        protocolName: 'auth',
        contentType: btpPacket.MIME_APPLICATION_OCTET_STREAM,
        data: Buffer.from('')
      }, {
        protocolName: 'auth_token',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('placeholder')
      }, {
        protocolName: 'auth_username',
        contentType: btpPacket.MIME_TEXT_PLAIN_UTF8,
        data: Buffer.from('')
      }]))

      this.newSocket.reply(btpPacket.TYPE_RESPONSE, r => {
        assert.equal(r.requestId, 100)
      })
    })
  })

  describe('disconnect', () => {
    it('should disconnect when connected', function * () {
      assert.isTrue(this.plugin.isConnected(), 'should have connected before')
      yield this.plugin.disconnect()
      assert.isFalse(this.plugin.isConnected(), 'shouldn\'t be connected after disconnect')
    })

    it('should stay disconnected when disconnected', function * () {
      yield this.plugin.disconnect()
      yield this.plugin.disconnect()
      assert.isFalse(this.plugin.isConnected(), 'still should be disconnected after second disconnect')
    })

    it('should reconnect', function * () {
      yield this.plugin.disconnect()
      yield this.plugin.connect()
      assert.isTrue(this.plugin.isConnected(), 'should have reconnected')
    })
  })
})
