/// <reference types="node" />
import { BtpSubProtocol } from '.';
export declare function protocolDataToIlpAndCustom(data: {
    protocolData: Array<BtpSubProtocol>;
}): {
    protocolMap: {};
    ilp: any;
    custom: any;
};
export declare function ilpAndCustomToProtocolData(data: {
    ilp?: Buffer;
    custom?: Object;
    protocolMap?: Map<string, Buffer | string | Object>;
}): Array<BtpSubProtocol>;
