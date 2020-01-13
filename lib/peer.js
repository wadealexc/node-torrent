const net = require('net');
const EventEmitter = require('events');
const Bitfield = require('bitfield');
const Message = require('./message').Message;
const MessageType = require('./message').MessageType;

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

        // Between chunks of data, unused data will be stored here
        this.receivedData = Buffer.alloc(0);
        this.amountRead = 0;

        // Each time we receive data, add it to our received buffer
        // Note: this may get inefficient if we transfer a lot of data.
        this.conn.on('data', (data) => {
            this.receivedData = Buffer.concat([this.receivedData, data]);
        });

        this.conn.on('connect', () => {
            console.log(this.peerStr() + ' tcp connection established');
            this._handshake();
        });

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
    _handshake() {
        let request = createHandshakeRequest(this.peerId, this.infoHash);
        // Send the handshake
        this.conn.write(request);

        // After receiving data the first time, parse what should be a handshake response
        this.conn.once('data', (data) => {
            this._readHandshakeResponse();
        });
    }

    /**
     * Parses a peer's response to our handshake. Ensures the protocol and infohash are valid.
     */
    _readHandshakeResponse() {
        let handshake = decodeHandshake(this.receivedData);
        this.amountRead += handshake.amountRead;

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
        this._receiveBitfield();
    }

    /**
     * 
     */
    _receiveBitfield() {
        // We need at least 5 unread bytes to read message length and type.
        // If we don't have 5 unread bytes, add a listener to run this function
        // again when we receive bytes.
        if (this.receivedData.length < this.amountRead + 5) {
            this.conn.once('data', (data) => {
                this._receiveBitfield();
            });
            return;
        }

        // We have data - read message length and type
        let message = new Message(this.receivedData.slice(this.amountRead));

        if (message.msgType !== MessageType.MSG_BITFIELD) {
            console.log('Expected MSG_BITFIELD, got: ' + message.msgType);
            console.log('Full message: ' + this.receivedData.slice(this.amountRead).toString('hex'));
            this.conn.end();
            return;
        }

        // Got MSG_BITFIELD. Increment amountRead by 5 and try to read the payload
        this.amountRead += 5;
        this._receiveBitfieldPayload(message);
    }

    _receiveBitfieldPayload(message) {
        // We need at least message.msgLength - 1 unread bytes to read
        // the payload (1 byte corresponded to the message type).
        // If we don't have enough bytes, add a listener to run this function
        // again when we receive bytes.
        let readSize = message.msgLength - 1;
        if (this.receivedData.length < this.amountRead + readSize) {
            this.conn.once('data', (data) => {
                this._receiveBitfieldPayload(message);
            });
            return;
        }

        // We have enough data - read payload:
        let payload = this.receivedData.slice(this.amountRead, this.amountRead + readSize);
        this.bitfield = new Bitfield(payload);
        this.emit('received bitfield', this.bitfield.buffer.length);
        this.conn.end();
    }

    /**
     * Public method to end the connection, in case that's needed
     */
    endConn() {
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
    response.amountRead = 49 + response.protocolIDLen;
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