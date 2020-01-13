const net = require('net');
const EventEmitter = require('events');

/**
 * Represents a connection with a peer
 */
class Peer extends EventEmitter {

    /**
     * Connects with a peer and performs a handshake
     * @param {*} peer Represents a peer. Has fields host, port
     * @param {*} peerId Our peer ID
     * @param {*} infoHash The infohash that represents the file we want
     */
    constructor (peer, peerId, infoHash) {
        super();

        // Create TCP connection with peer, setting timeout to 3 seconds
        this.conn = net.createConnection(peer.port, peer.host);
        this.conn.setTimeout(3000);

        this.infoHash = infoHash;

        this.conn.on('connect', () => {
            console.log('Completed TCP connection with peer ' + peer.host + ':' + peer.port);
            this._completeHandshake(peerId, infoHash);
        });

        this.conn.on('data', (data) => {
            if (!this.handshakeComplete) {
                console.log('Received response from peer ' + peer.host + ':' + peer.port);
                this._parseHandshakeResponse(Buffer.from(data));
            } else {
                console.log('Post-handshake data recieved from peer ' + peer.host + ':' + peer.port);
            }
        });

        this.conn.on('timeout', () => {
            console.log('Timeout with peer ' + peer.host + ':' + peer.port);
            this.conn.end();
        });

        this.conn.on('error', (err) => {
            console.log('Socket error with peer ' + peer.host + ':' + peer.port);
            console.log(err);
        });
    }

    _completeHandshake(peerId, infoHash) {
        let request = createHandshakeRequest(peerId, infoHash);
        this.conn.write(request, '', () => {
            console.log('Handshake request sent to peer ' + this.conn.remoteAddress + ':' + this.conn.remotePort);
        });
    }

    _parseHandshakeResponse(buff) {
        let handshake = decodeHandshake(buff);

        console.log('Handshake response from ' + this.conn.remoteAddress + ':' + this.conn.remotePort);

        let err = false;
        if (handshake.protocolIDLen !== 19) {
            console.log('Invalid protocol ID len recieved:' + handshake.protocolIDLen);
        }

        if (handshake.protocol !== 'BitTorrent protocol') {
            console.log('Invalid protocol: ' + handshake.protocol);
            err = true;
        }

        if (handshake.infoHash != this.infoHash) {
            console.log('Infohash mismatch');
            err = true;
        }

        if (!err) {
            console.log('Handshake successful with peer:' + handshake.peerId);
            console.log('...at ' + this.conn.remoteAddress + ':' + this.conn.remotePort);
        }

        console.log('Ending connection with peer ' + this.conn.remoteAddress + ':' + this.conn.remotePort);
        this.conn.on('close', () => {
            console.log('Connection ended with peer ' + this.conn.remoteAddress + ':' + this.conn.remotePort);
        });

        this.conn.end();
    }
}

/**
 * Decodes a handshake response from a peer and returns an object
 * with the handshake's fields
 */
function decodeHandshake(buff) {
    let response = {};
    response.protocolIDLen = buff.readUInt8(0);
    let ptr = 1
    response.protocol = buff.toString('utf8', ptr, ptr + response.protocolIDLen);
    ptr += response.protocolIDLen;
    response.opts = buff.toString('hex', ptr, ptr + 8);
    ptr += 8;
    response.infoHash = buff.toString('hex', ptr, ptr + 20);
    ptr += 20;
    response.peerId = buff.toString('hex', ptr, ptr + 20);
    return response;
}

/**
 * Create the BitTorrent handshake request. A handshake has 5 components:
 * 1. Length of the protocol identifier (19)
 * 2. Protocol identifier ("BitTorrent protocol")
 * 3. Eight reserved bytes used for protocol options / extensions (this impl sets all to 0)
 * 4. The file infohash
 * 5. Our peer id
 * @returns A buffer which will be passed to our net socket
 */
function createHandshakeRequest(peerId, infoHash) {
    let buff = Buffer.alloc(68, '', 'hex');
    buff.writeUInt8(19);
    buff.write('BitTorrent protocol', 1, 19, 'utf8');
    buff.write(infoHash, 28, 20, 'hex');
    buff.write(peerId, 48, 20, 'hex');
    return buff;
}

module.exports = Peer;