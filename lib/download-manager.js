const EventEmitter = require('events');
const Bitfield = require('bitfield');
const sha1 = require('sha1');
const debug = require('debug')('download-manager');

const EventQueue = require('./event-queue');
const Peer = require('./peer').Peer;

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

        debug('constructor');

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
        let bitfieldSize = Math.ceil(this.pieceHashes.length / 8);
        this.bitfield = new Bitfield(Buffer.alloc(bitfieldSize));

        // As we download files from our peers, we will collect each buffer in
        // this results object (mapped to piece index).
        this.results = {};

        // Create and populate work queue
        let work = [];
        for (let i = 0; i < this.pieceHashes.length; i++) {
            let pieceSize = this.downloadInfo['piece length'];
            let begin = i * pieceSize;
            let end = begin + pieceSize;
            if (end > this.downloadInfo.length) {
                end = this.downloadInfo.length;
            }

            work.push({
                index: i,
                size: end - begin
            });
        }

        // Queue for work that can be performed by peers
        this.workQueue = new EventQueue(work);
        // Queue for connected peers that are currently eligible for download
        this.peerQueue = new EventQueue();

        this.workQueue.on('push', () => {
            this._tryAssignWork();
        });

        this.peerQueue.on('push', () => {
            this._tryAssignWork();
        });
    }

    /**
     * Begins connecting to peers and downloading the file
     * @param {*} peers A list of peers received from the tracker (host, port)
     */
    startDownload(peers) {
        let handshakesCompleted = 0;
        let bitfieldsReceived = 0;

        debug('connecting to %d peers', peers.length);

        peers.forEach(peer => {
            debug('connecting to peer %s:%d', peer.host, peer.port);

            /**
             * The constructor will:
             * 1. Create a TCP connection with the peer
             * 2. Perform a BitTorrent handshake
             * 3. Receive a bitfield telling us which pieces the peer has
             * 4. Tell the peer to unchoke us and that we are ready to receive data
             */
            let p = new Peer(peer, this.peerId, this.infoHash);

            // If we get an error, the connection will be closed
            p.on('error', (reason) => {
                debug('%s errored with: %s', p, reason);
            });

            p.on('close', () => {
                debug('%s connection closed', p);
            });

            // Once all of the above steps are complete, the peer emits 'ready',
            // and we add them to our queue of active peers
            p.on('ready', () => {
                debug('%s ready for download', p);
                this.peerQueue.push(p);
            });

            // Once a peer has completed a download, validate the piece hash
            p.on('download complete', (piece) => {
                debug('#%d downloaded, checking hash...', piece.index);

                let hash = sha1(piece.buff);
                if (hash !== this.pieceHashes[piece.index]) {
                    debug('#%d hash mismatch', piece.index);

                    // Add work back to workQueue
                    this.workQueue.push({
                        index: piece.index,
                        size: piece.size
                    });
                } else {
                    debug('#%d hash is valid!');
                }

                // Add peer back to peerQueue
                this.peerQueue.push(p);
            });
        });
    }

    /**
     * TODO comment
     */
    _tryAssignWork() {
        debug('trying to assign work...');

        if (this.peerQueue.isEmpty() || this.workQueue.isEmpty()) {
            debug('...but a queue was empty');
            return;
        }

        let peersAssigned = [];

        for (const peer of this.peerQueue) {

            let assigned;
            for (const work of this.workQueue) {
                if (peer.hasPiece(work.index)) {
                    peer.assignWork(work);
                    assigned = work;
                    break;
                }
            }

            if (assigned) {
                this.workQueue.remove(assigned);
                peersAssigned.push(peer);
            }
        }

        peersAssigned.forEach(peer => {
            this.peerQueue.remove(peer);
        });
    }

    /**
     * Starts downloading pieces from a peer
     * @param {*} peer 
     */
    startDownloadWorker(peer) {
        // No point in attempting a download with no work in the queue
        if (this.workQueue.length === 0) {
            return;
        }

        /**
         * If the peer is currently choked, add a listener and evoke this function
         * when we are unchoked. Peer status is updated every time data is received.
         */
        if (peer.isChoked()) {
            peer.once('unchoked', () => {
                this.startDownloadWorker(peer);
            });
        }

        // Grab work from the front of the workQueue
        let work = this.workQueue.shift();
        let lookup;

        while (true) {
            lookup = peer.hasPiece(index);
            // We've exhausted the queue for this peer and they do not
            // have any more pieces to offer. End connection.
            if (lookup === PieceLookup.ALREADY_CHECKED) {
                peer.endConn();
                return;
            } else if (lookup === PieceLookup.DOES_HAVE) {
                // This peer has the piece we want! Request the piece.
                peer.attemptDownloadPiece(work);

                peer.once('download complete', (result) => {
                    let isValid = this._checkResultHash(work.index, result);
                    if (isValid) {
                        this.resultsQueue.push({ piece: work.index, buff: result });
                    } else {
                        // Invalid hash, put work back on queue
                        this.workQueue.push(work);
                        work = this.workQueue.shift();
                    }
                });
            } else {
                // Put the work back on the end of the queue
                this.workQueue.push(work);
                // Grab a new piece
                work = this.workQueue.shift(); 
            }
        }
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