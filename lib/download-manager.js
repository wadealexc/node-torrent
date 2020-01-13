const EventEmitter = require('events');
const Bitfield = require('bitfield');

const Peer = require('./peer');

/**
 * Manages connections and requests to peers
 */
class DownloadManager extends EventEmitter {

    /**
     * Constructor. Validates that download info is sane and
     * calculates SHA1 hashes of each piece of the download.
     * @param {*} downloadInfo 'info' struct from the torrent file
     * @param {*} peerId Our peer ID
     * @param {*} infoHash The file's unique identifier
     */
    constructor (downloadInfo, peerId, infoHash) {
        super();

        // Check that downloadInfo has required fields
        if (!downloadInfo.length) {
            throw 'Missing download length from obj: ' + downloadInfo;
        }

        if (!downloadInfo.name) {
            throw 'Missing download name from obj: ' + downloadInfo;
        }

        if (!downloadInfo['piece length']) {
            throw 'Missing piece length from obj: ' + downloadInfo;
        }

        if (!downloadInfo.pieces) {
            throw 'Missing pieces from obj: ' + downloadInfo;
        }

        this.peerId = peerId;
        this.infoHash = infoHash;
        this.downloadInfo = downloadInfo;

        // Unmarshal SHA1 hashes of each of the file's pieces
        this.pieceHashes = unmarshalHashes(downloadInfo.pieces);

        // Create a bitfield representing the torrent
        let bitfieldSize = Math.floor(this.pieceHashes.length / 8);
        if (this.pieceHashes.length % 8 !== 0) { 
            bitfieldSize++; 
        }
        this.bitfield = new Bitfield(Buffer.alloc(bitfieldSize));
    }

    /**
     * Begins connecting to peers and downloading file
     * @param {*} peers A list of peers received from the tracker (host, port)
     */
    start(peers) {
        let completedHandshake = [];
        let receivedBitfield = [];

        peers.forEach(peer => {
            let p = new Peer(peer, this.peerId, this.infoHash);

            p.on('handshake successful', (peerId) => {
                console.log(p.peerStr() + ' handshake successful as peer ' + peerId);
                completedHandshake.push(p);

                console.log(completedHandshake.length + ' peers completed handshakes');
            });

            p.on('received bitfield', (size) => {
                if (size !== this.bitfield.buffer.length) {
                    console.log(p.peerStr() + ' invalid bitfield size. expected: ' + this.bitfield.buffer.length + ', got: ' + size);
                }

                console.log(p.peerStr() + ' received valid bitfield')
                receivedBitfield.push(p);
                console.log(receivedBitfield.length + ' of ' + completedHandshake.length + ' peers ready for download');
                p.endConn();
            });
        });
    }
}

/**
 * SHA-1 hashes of each piece of the file are provided as a binary blob. This function
 * unmarshals that blob and returns a list of hashes.
 */
function unmarshalHashes(pieces) {
    let HASH_SIZE = 20;
    if (pieces.length % HASH_SIZE !== 0) {
        throw 'Malformed pieces buffer recieved';
    }

    let hashes = [];
    for (let i = 0; i < pieces.length; i += HASH_SIZE) {
        let hash = pieces.toString('hex', i, i + HASH_SIZE);
        hashes.push(hash);
    }
    return hashes;
}

module.exports = DownloadManager;