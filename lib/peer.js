const net = require('net');
const EventEmitter = require('events');
const Bitfield = require('bitfield');
const debug = require('debug')('peer');

const Message = require('./message').Message;
const MessageType = require('./message').MessageType;

const MAX_BACKLOG = 5;
const MAX_REQUEST_SIZE = 16384; // 16KB

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

        debug('constructor');

        this.peer = peer;
        this.peerId = peerId;
        this.infoHash = infoHash;

        // Assume we are choked by default
        this.isChoked = true;
        this.handshakeComplete = false;
        this.hasBitfield = false;

        // This is where we push any data our peer sends us.
        // amountRead will act as an index to show us where to read next
        this.receivedData = Buffer.alloc(0);
        this.amountRead = 0;

        // Create TCP connection with peer, setting timeout to 3 seconds
        this.conn = net.createConnection(peer.port, peer.host);
        this.conn.setTimeout(3000);

        // Each time we receive data, add it to our received buffer.
        // Events are called synchronously in the order listeners were added
        // so we know that each time we get data, this will be the first function
        // to run.
        //
        // Note: buffer concatenation may get slow if we get a lot of data
        this.conn.on('data', (data) => {
            debug('%s | received %d bytes', this, data.length);
            // If data.length is 0, this is a keep-alive message and we don't do anything
            if (data.length === 0) { return; }

            // Add the received data to our buffer, then process messages if needed
            this.receivedData = Buffer.concat([this.receivedData, data]);
            this._readAndProcessMessages();
        });

        // After establishing a TCP connection, we need to perform a handshake
        this.conn.on('connect', () => {
            debug('%s | tcp connected', this);
            
            // Disable socket timeout (0 removes an existing timeout)
            this.conn.setTimeout(0);
            this._sendHandshake();
        });

        // If our connection times out, emit 'error'
        // After a timeout, we need to manually close the connection.
        this.conn.on('timeout', () => {
            debug('%s | timed out', this);
            
            this.emit('error', 'timed out');
            this.conn.end();
        });

        // If we get a socket error, emit 'error'
        // The connection is automatically closed.
        this.conn.on('error', (err) => {
            debug('%s | socket error', this);

            this.emit('error', 'socket error');
        });

        // When the connection is closed, emit 'close'
        this.conn.on('close', () => {
            debug('%s | connection closed', this);
            
            this.emit('close');
        });
    }

    /**
     * This is called each time we receive data from the peer
     */
    _readAndProcessMessages() {
        debug('%s | entered main loop', this);

        // If we have not completed a handshake, that's first!
        // If we don't succeed, simply return.
        if (this.handshakeComplete === false) {
            let success = this._readHandshake();
            if (!success) { return; }
        }

        // If the peer has not sent us a bitfield, that's next!
        // If we don't succeed, simply return.
        if (this.hasBitfield === false) {
            let success = this._readBitfield();
            if (!success) { return; }
            // After we successfully receive the bitfield, tell the peer we are
            // ready to receive files
            this._sendUnchoke();
            this._sendInterested();

            // Emit 'ready,' so the DownloadManager can assign this peer work
            this.emit('ready');
        }

        // Loop over each unread message in our received data
        // Messages should contain at least 5 bytes:
        // 4 bytes for message size, 1 byte for message type
        while (this.getUnreadSize() >= 5) {
            debug('%s | processing unread', this);

            // Parse message from first 5 bytes
            let message = new Message(this.receivedData.slice(this.amountRead, this.amountRead + 5));
            // If we don't have enough unread bytes to process the message payload, return
            if (this.getUnreadSize() < 4 + message.msgLength) { return; }

            debug('%s | received message: %s', this, message.nameString());

            // Process message based on message type:
            switch (message.msgType) {
                case MessageType.MSG_UNCHOKE:
                    // Peer has unchoked us - we can request data
                    this.isChoked = false;
                    this.amountRead += 5;
                    break;
                case MessageType.MSG_CHOKE:
                    // Peer has choked us - we should not request data until unchoked
                    this.isChoked = true;
                    this.amountRead += 5;
                    break;
                case MessageType.MSG_HAVE:
                    // Peer is telling us they have some piece - parse which piece
                    // then set the corresponding bit in the bitfield.
                    //
                    // The payload represents the index of the piece the peer has.
                    let index = this.receivedData.readUInt32BE(this.amountRead + 5);
                    this.bitfield.set(index);
                    debug('%s | has piece #%d', this, index);
                    // Increment amountRead
                    this.amountRead += 9;
                    break;
                case MessageType.MSG_PIECE:
                    // Peer has sent us part of a piece. If we were not expecting one,
                    // simply skip past the message
                    if (this._awaitingPiece() === false) {
                        this.amountRead += message.msgLength;
                        break;
                    }

                    // We're expecting piece data from the peer. Read it.
                    this._readPiece(message);
                    
                    // Download complete! Emit an event and delete this.currentPiece
                    if (this.currentPiece.downloaded === this.currentPiece.size) {
                        
                        debug('%s | completed #%d', this, this.currentPiece.index);
                        this.emit('download complete', this.currentPiece);
                        this.currentPiece = undefined;
                        break;
                    }

                    break;
                default:
                    debug('%s | other message: %s', this, message.nameString());
                    // We don't handle other types of messages, so just increment
                    // this.amountRead by 4 + message.msgLength
                    this.amountRead += 4 + message.msgLength;
                    break;
            }
        }

        debug('%s | finished reading messages', this);

        // If we have no more data left to read, delete this.receivedData and this.amountRead
        if (this.getUnreadSize() === 0) {
            this.receivedData = Buffer.alloc(0);
            this.amountRead = 0;
        }

        // While our request backlog isn't full and we can request more data, do so.
        while (this._shouldRequest()) {
            this._sendRequest();
        }

        debug('%s | exiting read loop', this);
    }

    /**
     * Sends the peer a handshake request and parses any response
     */
    _sendHandshake() {
        debug('%s | sending handshake', this);

        let request = createHandshakeRequest(this.peerId, this.infoHash);
        // Send the handshake and set socket to timeout after 10 seconds of inactivity
        // We will disable the timeout once we've received a handshake and bitfield
        this.conn.write(request);
        this.conn.setTimeout(10000);
    }

    /**
     * Parses a peer's response to our handshake. Ensures the protocol and infohash are valid.
     */
    _readHandshake() {
        debug('%s | reading handshake', this);
        
        let handshake = decodeHandshake(this.receivedData);

        // Make sure we're getting expected values back
        if (handshake.protocol !== 'BitTorrent protocol') {
            debug('%s | unexpected protocol', this);

            this.emit('error', 'unexpected protocol');
            this.conn.end();
            return false;
        }

        if (handshake.infoHash !== this.infoHash) {
            debug('%s | infohash mismatch', this);

            this.emit('error', 'infohash mismatch');
            this.conn.end();
            return false;
        }

        debug('%s | handshake complete', this);

        // Handshake successful! Increment amount read.
        this.handshakeComplete = true;
        this.amountRead += handshake.amountRead;
        return true;
    }

    /**
     * Read MSG_BITFIELD from peer. Each index of the bitfield
     * corresponds to a piece the peer can send us.
     */
    _readBitfield() {
        debug('%s | reading bitfield', this);

        // We need at least 5 bytes to read the message length and type
        if (this.getUnreadSize() < 5) { return false; }

        // We have enough data - read message length and type
        let message = new Message(this.receivedData.slice(this.amountRead, this.amountRead + 5));
        // Make sure we have enough unread data to read the entire message
        if (this.getUnreadSize() < 4 + message.msgLength) { return false; }

        // The first message we get should be the bitfield
        if (message.msgType !== MessageType.MSG_BITFIELD) {
            debug('%s | expected bitfield, got: %s', this, message.nameString());

            this.emit('error', 'expected bitfield');
            this.conn.end();
            return false;
        }

        // Read size is msgLength minus 1 byte for message type
        let readSize = message.msgLength - 1;
        let start = this.amountRead + 5;
        let end = this.amountRead + readSize;

        // Read bitfield from received data
        let payload = this.receivedData.slice(start, end);
        this.bitfield = new Bitfield(payload);

        debug('%s | received bitfield', this);

        // Successfully received bitfield. Increment amountRead and disable socket timeout
        this.hasBitfield = true;
        this.amountRead += message.msgLength + 4;
        this.conn.setTimeout(0);
        return true;
    }

    /**
     * Sends our peer an "unchoke" request
     */
    _sendUnchoke() {
        debug('%s | sending unchoke', this);

        let msg = Message.serialize(MessageType.MSG_UNCHOKE);
        this.conn.write(msg);
    }

    /**
     * Tells our peer we are interested in receiving data
     */
    _sendInterested() {
        debug('%s | sending interested', this);

        let msg = Message.serialize(MessageType.MSG_INTERESTED);
        this.conn.write(msg);
    }

    /**
     * Returns whether we are waiting on a piece from the peer
     */
    _awaitingPiece() {
        if (!this.currentPiece) { return false; }

        if (this.currentPiece.downloaded === this.currentPiece.size) { return false; }

        return true;
    }

    /**
     * Reads MSG_PIECE from peer. Note that MSG_PIECE only contains PART of a piece (up to 16KB)
     * @param {*} message The message we parsed from the first 5 bytes of this.receivedData
     */
    _readPiece(message) {
        debug('%s | reading piece', this);

        // Read size is msgLength minus 1 byte for message type
        let readSize = message.msgLength - 1;
        let start = this.amountRead + 5;
        let end = this.amountRead + readSize;

        // Read payload
        let payload = this.receivedData.slice(start, end);
        // Parse MSG_PIECE, which consists of:
        // index (4 bytes): The index of the piece in the overall file
        // offset (4 bytes): The start position of the sent data within the piece
        // data: The part of the piece the peer sent us
        let index = payload.readUInt32BE(0);
        let offset = payload.readUInt32BE(4);
        let data = payload.slice(8);

        // Unexpected piece sent - skip message by incrementing amountRead and returning
        if (index !== this.currentPiece.index) {
            debug('%s | piece index mismatch. expected: %d, got: %d', this, this.currentPiece.index, index);

            this.amountRead += 4 + message.msgLength;
            return;
        }

        // Copy data into currentPiece buffer
        data.copy(this.currentPiece.buff, offset);

        // Increment amount read
        this.amountRead += message.msgLength + 4;

        // Decrement backlog and increase amount downloaded
        this.currentPiece.backlog--;
        this.currentPiece.downloaded += data.length;
        
        debug(
            '%s | sent %d of %d total. (piece #%d)', 
            this, this.currentPiece.downloaded, this.currentPiece.size, index
        );
    }

    /**
     * Returns whether or not we should send a request for data to the peer
     */
    _shouldRequest() {
        if (!this.currentPiece) { return false; }

        if (this.isChoked) { return false; }

        if (this.currentPiece.backlog < MAX_BACKLOG && this.currentPiece.requested < this.currentPiece.size) {
            return true;
        }

        debug('%s | should not request. backlog: %d, requested: %d of %d', this, this.currentPiece.backlog, this.currentPiece.requested, this.currentPiece.size);

        return false;
    }

    /**
     * Requests data from the peer
     */
    _sendRequest() {

        let index = this.currentPiece.index;
        let offset = this.currentPiece.requested;

        // Default to requesting the maximum amount (16KB)
        let amount = MAX_REQUEST_SIZE;
        if (this.currentPiece.size - this.currentPiece.requested < amount) {
            amount = this.currentPiece.size - this.currentPiece.requested;
        }

        debug('%s | requesting %d bytes of #%d', this, amount, index);

        // Format MSG_REQUEST and construct complete message
        let payload = Message.formatRequest(index, offset, amount);
        let msg = Message.serialize(MessageType.MSG_REQUEST, payload);

        // Send to peer
        this.conn.write(msg);

        // Increment current backlog and amount requested
        this.currentPiece.backlog++;
        this.currentPiece.requested += amount;

        debug('%s | sent request', this);
    }

    /**
     * Assign a piece to download from this peer
     */
    assignWork(piece) {
        debug('%s | assigned #%d', this, piece.index);

        this.currentPiece = {
            index: piece.index,
            size: piece.size,
            downloaded: 0,
            requested: 0,
            backlog: 0,
            buff: Buffer.alloc(piece.size)
        };

        // Even if there aren't any messages, calling _readAndProcess... will
        // begin sending requests to the peer.
        this._readAndProcessMessages();
    }

    /**
     * Returns whether this peer's bitfield has a piece
     * @param {*} index The index of the piece
     */
    hasPiece(index) {
        return this.bitfield.get(index);
    }

    /**
     * Gets the number of unread bytes in this.receivedData
     */
    getUnreadSize() {
        return this.receivedData.length - this.amountRead;
    }

    /**
     * Returns host IP address
     */
    toString() {
        return this.peer.host;
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

exports.Peer = Peer;