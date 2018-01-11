'use strict'

const crypto = require('crypto')
const debug = require('debug')('ilp-plugin-btp:util')
const fetch = require('node-fetch')

async function isPassCompromised (pass) {
  try {
    const hash = crypto.createHash('sha1').update(pass, 'utf8').digest().toString('hex')
    const res = await fetch('https://haveibeenpwned.com/api/v2/pwnedpassword/' + hash)
    return res.status !== 404 // 404 = password is not compromised
  } catch (err) {
    debug('Could not check if password is compromised: ', err)
    return true
  }
}

module.exports = {
  isPassCompromised
}
