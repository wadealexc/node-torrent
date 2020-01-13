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

        this.peer = peer;
        this.peerId = peerId;
        this.infoHash = infoHash;

        this.conn.on('connect', () => {
            console.log(this.peerStr() + ' tcp connection established');
            this._completeHandshake();
        });

        // this.conn.on('data', (data) => {
        //     this._parseHandshakeResponse(Buffer.from(data));
        // });

        this.conn.on('close', () => {
            console.log(this.peerStr() + ' connection ended');
        });

        this.conn.on('timeout', () => {
            console.log(this.peerStr() + ' timed out');
            this.emit('timeout');
            this.conn.end();
        });

        this.conn.on('error', (err) => {
            console.log(this.peerStr() + ' socket error');
            this.emit('socket error');
        });
    }

    /**
     * Sends the peer a handshake request and parses any response
     */
    _completeHandshake() {
        let request = createHandshakeRequest(this.peerId, this.infoHash);
        // Send the handshake
        this.conn.write(request, '', () => { });

        // After receiving data the first time, parse what should be a handshake response
        this.conn.once('data', (data) => {
            this._parseHandshakeResponse(Buffer.from(data));
        });
    }

    /**
     * Parses a peer's response to our handshake. Ensures the protocol and infohash are valid.
     * @param {*} buff The peer's response
     */
    _parseHandshakeResponse(buff) {
        let handshake = decodeHandshake(buff);

        if (handshake.protocol !== 'BitTorrent protocol') {
            this.emit('invalid protocol');
            this.conn.end();
            return;
        }

        if (handshake.infoHash != this.infoHash) {
            this.emit('infohash mismatch');
            this.conn.end();
            return;
        }

        this.emit('handshake successful', handshake.peerId);

        // temp - here is where we add another listener for 'data' events
        // so that we can receive the bitfield
        console.log(this.peerStr() + ' ending connection');
        this.conn.end();
    }

    /**
     * Converts a peer host and port to a readable string
     */
    peerStr() {
        return this.peer.host + ':' + this.peer.port;
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