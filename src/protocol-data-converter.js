"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Btp = require('btp-packet');
const base64url = require('base64url');
function protocolDataToIlpAndCustom(data) {
    const protocolMap = {};
    const { protocolData } = data;
    for (const protocol of protocolData) {
        const name = protocol.protocolName;
        if (protocol.contentType === Btp.MIME_TEXT_PLAIN_UTF8) {
            protocolMap[name] = protocol.data.toString('utf8');
        }
        else if (protocol.contentType === Btp.MIME_APPLICATION_JSON) {
            protocolMap[name] = JSON.parse(protocol.data.toString('utf8'));
        }
        else {
            protocolMap[name] = protocol.data;
        }
    }
    return {
        protocolMap,
        ilp: protocolMap['ilp'],
        custom: protocolMap['custom']
    };
}
exports.protocolDataToIlpAndCustom = protocolDataToIlpAndCustom;
function ilpAndCustomToProtocolData(data) {
    const protocolData = [];
    const { ilp, custom, protocolMap } = data;
    if (ilp) {
        protocolData.push({
            protocolName: 'ilp',
            contentType: Btp.MIME_APPLICATION_OCTET_STREAM,
            data: ilp
        });
    }
    if (protocolMap) {
        const sideProtocols = Object.keys(protocolMap);
        for (const protocol of sideProtocols) {
            if (Buffer.isBuffer(protocolMap[protocol])) {
                protocolData.push({
                    protocolName: protocol,
                    contentType: Btp.MIME_APPLICATION_OCTET_STREAM,
                    data: protocolMap[protocol]
                });
            }
            else if (typeof protocolMap[protocol] === 'string') {
                protocolData.push({
                    protocolName: protocol,
                    contentType: Btp.MIME_TEXT_PLAIN_UTF8,
                    data: Buffer.from(protocolMap[protocol])
                });
            }
            else {
                protocolData.push({
                    protocolName: protocol,
                    contentType: Btp.MIME_APPLICATION_JSON,
                    data: Buffer.from(JSON.stringify(protocolMap[protocol]))
                });
            }
        }
    }
    if (custom) {
        protocolData.push({
            protocolName: 'custom',
            contentType: Btp.MIME_APPLICATION_JSON,
            data: Buffer.from(JSON.stringify(custom))
        });
    }
    return protocolData;
}
exports.ilpAndCustomToProtocolData = ilpAndCustomToProtocolData;
//# sourceMappingURL=protocol-data-converter.js.map