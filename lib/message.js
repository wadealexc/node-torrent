const MessageType = {
    // Chokes the receiver
    MSG_CHOKE: 0,
    // Unchokes the receiver
    MSG_UNCHOKE: 1,
    // Tells the receiver that the sender wants data
    MSG_INTERESTED: 2,
    // Tells the receiver that the sender does not want data
    MSG_NOT_INTERESTED: 3,
    // Tells the receiver that the sender has some piece
    MSG_HAVE: 4,
    // Tells the receiver which pieces the sender has
    MSG_BITFIELD: 5,
    // Requests a block of data from the receiver
    MSG_REQUEST: 6,
    // Delivers a block of data to the receiver
    MSG_PIECE: 7,
    // Cancels a request for data
    MSG_CANCEL: 8
};

/**
 * Provides some utility functions for reading messages from peers. 
 * This class is pretty incomplete and could be improved (but I doubt I'll do that).
 */
class Message {

    /**
     * Reads the first 5 bytes of a passed-in buffer. BitTorrent messages
     * consist of 3 parts:
     * length (4 bytes): The length of the payload, including the type
     * type (1 byte): The type of message (see MessageType above)
     * payload (x bytes, optional): The payload. 
     */
    constructor (buff) {
        this.msgLength = buff.readUInt32BE(0);
        this.msgType = Message.getMessageType(buff[4]);
    }

    /**
     * Utility method to convert a Message's msgType to a readable string
     */
    nameString() {
        switch (this.msgType) {
            case MessageType.MSG_CHOKE:
                return 'MSG_CHOKE';
            case MessageType.MSG_UNCHOKE:
                return 'MSG_UNCHOKE';
            case MessageType.MSG_INTERESTED:
                return 'MSG_INTERESTED';
            case MessageType.MSG_NOT_INTERESTED:
                return 'MSG_NOT_INTERESTED';
            case MessageType.MSG_HAVE:
                return 'MSG_HAVE';
            case MessageType.MSG_BITFIELD:
                return 'MSG_BITFIELD';
            case MessageType.MSG_REQUEST:
                return 'MSG_REQUEST';
            case MessageType.MSG_PIECE:
                return 'MSG_PIECE';
            case MessageType.MSG_CANCEL:
                return 'MSG_CANCEL';
            default:
                return 'MSG_UNKNOWN:' + this.msgType;
        }
    }

    /**
     * Returns a buffer containing the payload of a piece request
     * @param {*} index The index of the piece
     * @param {*} start The offset to the data within the piece
     * @param {*} amount The amount of data we're requesting
     */
    static formatRequest(index, start, amount) {
        let buff = Buffer.alloc(12);
        buff.writeUInt32BE(index, 0);
        buff.writeUInt32BE(start, 4);
        buff.writeUInt32BE(amount, 8);
        return buff;
    }

    /**
     * Serializes a message given a msgType and optional payload
     * @param {*} msgType MessageType enum
     * @param {*} payload (optional) buffer payload to include
     */
    static serialize(msgType, payload) {
        let allocSize = 5;
        let encodedLen = 1;
        if (Buffer.isBuffer(payload)) {
            allocSize += payload.length;
            encodedLen += payload.length;
        }

        let msg = Buffer.alloc(allocSize);
        msg.writeUInt32BE(encodedLen);
        msg[4] = msgType;
    
        if (Buffer.isBuffer(payload)) {
            msg.fill(payload, 5);
        }

        return msg;
    }

    /**
     * Converts an integer to a MessageType
     * @param {*} val The integer read from the message buffer
     */
    static getMessageType(val) {
        switch(val) {
            case 0:
                return MessageType.MSG_CHOKE;
            case 1:
                return MessageType.MSG_UNCHOKE;
            case 2:
                return MessageType.MSG_INTERESTED;
            case 3:
                return MessageType.MSG_NOT_INTERESTED;
            case 4:
                return MessageType.MSG_HAVE;
            case 5:
                return MessageType.MSG_BITFIELD;
            case 6:
                return MessageType.MSG_REQUEST;
            case 7:
                return MessageType.MSG_PIECE;
            case 8:
                return MessageType.MSG_CANCEL;
            default:
                return;
        }
    }
}

exports.MessageType = MessageType;
exports.Message = Message;