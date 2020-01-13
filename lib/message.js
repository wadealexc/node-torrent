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

class Message {

    constructor (buff) {
        // TODO handle case where buffer is of insufficient size for first 2 fields
        this.msgLength = buff.readUInt32BE(0);
        this.msgType = getMessageType(buff[4]);
    }
}

/**
 * Converts an integer to a MessageType
 * @param {*} val The integer read from the message buffer
 */
function getMessageType(val) {
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

exports.MessageType = MessageType;
exports.Message = Message;