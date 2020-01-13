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
        this.bitfield = new Bitfield(this.pieceHashes.length);
    }

    /**
     * Begins connecting to peers and downloading file
     * @param {*} peers A list of peers received from the tracker (host, port)
     */
    start(peers) {
        peers.forEach(peer => {
            new Peer(peer, this.peerId, this.infoHash);
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