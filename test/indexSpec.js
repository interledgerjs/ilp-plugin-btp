'use strict'

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const nock = require('nock')

const PluginBtp = require('..')
const options = {
  server: 'btp+wss://user:placeholder@example.com/rpc'
}

describe('constructor', () => {
  it('should be a function', () => {
    assert.isFunction(PluginBtp)
  })

  it('should return an object', () => {
    assert.isObject(new PluginBtp(options))
  })
})

describe('connect', () => {
  describe('client', () => {
    beforeEach(() => {
      this.client = new PluginBtp({
        server: 'btp+ws://:P@assw0rd@localhost:9000'
      })
    })

    afterEach(() => {
      assert(nock.isDone(), 'nock must be called')
    })

    it('does throw if password is compromissed', () => {
      nock('https://haveibeenpwned.com')
        .get('/api/v2/pwnedpassword/129085e701cae7616fd8c77594e3ad642b909aec')
        .reply(200)

      return assert.isRejected(this.client.connect(), 
        'Your password is compromised. Choose a strong, random password.')
    })  
  })
})
