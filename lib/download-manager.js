const EventEmitter = require('events');
const Bitfield = require('bitfield');
const sha1 = require('sha1');
const debug = require('debug')('download-manager');

const PieceCollector = require('./piece-collector');
const EventQueue = require('./event-queue');
const PendingQueue = require('./pending-queue');
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
     * @param {*} file The name of the file to create once the download is complete
     */
    constructor (downloadInfo, peerId, infoHash, file) {
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
        let bitfieldSize = Math.ceil(this.pieceHashes.length / 8);
        this.bitfield = new Bitfield(Buffer.alloc(bitfieldSize));

        let pieceSize = this.downloadInfo['piece length'];

        // Collection of all the peers currently connected and available for download
        this.totalConnected = new EventQueue();

        // As we download pieces from peers, we will collect results here
        this.result = new PieceCollector(this.pieceHashes.length, pieceSize, file);
        // Once we've collected all pieces, disconnect from all peers
        this.result.on('collection complete', () => {
            for (const peer of this.totalConnected) {
                try {
                    peer.disconnect();
                } catch (e) { debug('%s errored on disconnect with %s', peer, e); }
            }
        });
        // Once everything has been downloaded and written to file, exit!
        this.result.on('write complete', () => {
            console.log('Download complete!');
            process.exit(1);
        });

        // Create and populate work queue
        let work = [];
        for (let i = 0; i < this.pieceHashes.length; i++) {
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

        // Queue for work that no peers are currently working on
        this.unclaimed = new EventQueue(work);
        // Queue for active jobs being performed by peers
        this.pending = new PendingQueue();

        // Queue for peers that are not currently assigned to jobs
        this.unemployed = new EventQueue();
        // Each time a peer is added to this queue, attempt to assign work.
        this.unemployed.on('push', () => {
            this._assignWork();
        });
    }

    /**
     * Adds peers to the download manager. We connect to each and begin
     * downloading pieces of the file.
     * @param {*} peers A list of peers received from the tracker
     */
    addPeers(peers) {

        debug('received %d peers', peers.length);

        peers.forEach(peer => {

            debug('connecting to %s', peer.host);
            /**
             * The constructor will:
             * 1. Create a TCP connection with the peer
             * 2. Perform a BitTorrent handshake
             * 3. Receive a bitfield telling us which pieces the peer has
             * 4. Tell the peer to unchoke us and that we are ready to receive data
             */
            let p = new Peer(peer, this.peerId, this.infoHash);

            // Handshake complete and bitfield received. Ready to go!
            p.on('ready', () => {

                this.totalConnected.push(p);

                debug('%s ready for download, %d total peers ready', p, this.totalConnected.size());

                // The peer's connection was closed. Clean up after them.
                p.on('close', () => {
                    this.totalConnected.remove(p);

                    // If the peer was not working on a piece, we don't need to clean up
                    if (!p.awaitingPiece()) { return; }

                    // Remove the pair from the pending queue:
                    let work = p.currentPiece.work;
                    this.pending.removeWorker(p);

                    /**
                     * Otherwise: if the piece has not been completed by another peer
                     * and is not currently being worked on by a peer, put the piece
                     * back into this.unclaimed
                     */
                    if (!this.result.contains(work.index) && this.pending.numWorkers(work) === 0) {
                        this.unclaimed.push(work);
                    }
                });

                /**
                 * When a peer completes a download, check the hash of the data.
                 * If the hash is correct, collect the piece in this.results
                 * If the hash is not correct, put the work back on the proper queue
                 * Finally, add the peer back to the unemployed queue.
                 */
                p.on('download complete', (result) => {
                    let hash = sha1(result.buff);
                    let index = result.work.index;

                    if (hash !== this.pieceHashes[index]) {
                        debug('#%d hash mismatch', index);

                        /**
                         * If the piece has not been completed by another peer
                         * and is not currently being worked on by another peer
                         * then put it back into this.unclaimed.
                         * 
                         * Note that numWorkers is 1 because we have not yet removed
                         * this peer from the pending queue
                         */
                        if (!this.result.contains(index) && this.pending.numWorkers(result.work) === 1) {
                            this.unclaimed.push(result.work);
                        }
                    } else {
                        // Print download status
                        let completion = '(' + this.result.percentComplete() + '%)';
                        let numPeers = this.totalConnected.size();
                        console.log(`${completion} | Downloaded piece #${index} from ${numPeers} peers`);

                        // Hash matches! Add the piece to our collected pieces
                        this.result.collect(index, result.buff);
                    }

                    // Remove the peer / work pair from the pending queue
                    this.pending.removeWorker(p);
                    // Put the peer back on the unemployed queue
                    this.unemployed.push(p);
                });

                // Add peer to unemployed queue, where they will be assigned a job
                this.unemployed.push(p);
            });
        });
    }

    /**
     * Attempts to assign work to any unemployed peers. Work is assigned from
     * the unclaimed queue first. If the peer cannot accept anything from this
     * queue (or it is empty), we attempt to assign the peer some work from the
     * pending queue. We may assign the same piece to multiple peers.
     * 
     * This function is run once when we first complete a handshake with a peer,
     * and then again each time we completely download a piece from the peer.
     */
    _assignWork() {
        // Download is complete - nothing to do here
        if (this.result.isComplete()) { return; }

        // Find work for all our unemployed peers
        while (this.unemployed.size() !== 0) {
            let peer = this.unemployed.pop();
            let assignment;

            // First, check to see if there's any unclaimed work
            for (const work of this.unclaimed) {

                if (peer.hasPiece(work.index)) {
                    assignment = work;
                    break;
                }
            }

            // If we were able to find work, remove it from the unclaimed queue
            // Then, push the peer and work pair to our pending queue.
            if (assignment) {
                debug('assigned #%d (unclaimed) to %s | %d remaining', assignment.index, peer, this.unclaimed.size());
                this.unclaimed.remove(assignment);
                this.pending.push({
                    peer: peer,
                    work: assignment
                });

                continue;
            }

            // No unclaimed work left, so give the peer a job from the pending queue
            for (const job of this.pending) {
                let index = job.work.index;

                // Make sure we're getting an incomplete piece
                if (!this.result.contains(index) && peer.hasPiece(index)) {
                    assignment = job.work;
                    break;
                }
            }

            // We gave the peer some redundant work - push to the pending queue
            if (assignment) {
                debug('assigned #%d (redundant) to %s | %d remaining', assignment.index, peer, this.unclaimed.size());
                this.pending.push({
                    peer: peer,
                    work: assignment
                });

                continue;
            }

            // If we weren't able to find any work for this peer in the unclaimed
            // and the pending queues, disconnect.
            debug('unable to find work for %s out of %d unclaimed, %d pending', peer, this.unclaimed.size(), this.pending.size());
            peer.disconnect();
        }

        // Start all the jobs in our pending queue
        this.pending.startAll();
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