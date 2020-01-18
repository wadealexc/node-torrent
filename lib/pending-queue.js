const debug = require('debug')('pending-queue');

/**
 * Special queue that keeps track of which peers we are currently
 * downloading from. Each time we start downloading a piece from a
 * peer, we add it to DownloadManager.pending (which is an instance
 * of this class).
 * 
 * Also, this class is responsible for actually telling the peer
 * to start requesting pieces (see startAll).
 */
class PendingQueue {

    constructor () {
        this.queue = [];
        this.ptr = 0;
    }

    /**
     * Push an object to the pending queue
     * @param {*} obj Should be { peer: (some Peer), work: { index, size } }
     */
    push(obj) {
        this.queue.push(obj);
    }

    /**
     * Removes a worker and their work from the queue
     */
    removeWorker(peer) {
        for (const job of this.queue) {

            // Target acquired.
            if (job.peer === peer) {
                // Wow, what a roundabout way to do this
                // :shrug: life's short and so is this.queue
                let idx = this.queue.indexOf(job);
                this.queue.splice(idx, 1);

                // If the job we're removing has already been started, decrement ptr
                if (idx < this.ptr) {
                    this.ptr--;
                }
                
                return;
            }
        }

        debug('%s not found in queue', peer);
    }

    /**
     * Returns the number of peers working on this work (even if they haven't started)
     * @param {*} work A piece of work { index: i, size: s }
     */
    numWorkers(work) {
        let num = 0;
        for (const job of this.queue) {
            if (job.work === work) {
                num++;
            }
        }
        return num;
    }

    /**
     * Calls peer.assignWork for each pending peer
     * I use this because assignWork does a lot of funky stuff and I don't want
     * to call it in the middle of an important loop (download-manager._assignWork)
     */
    startAll() {
        let prePtr = this.ptr;
        while (this.ptr < this.queue.length) {
            let job = this.queue[this.ptr];
            this.ptr++;

            job.peer.assignWork(job.work);
        }

        debug('assigned %d jobs', this.ptr - prePtr);
    }

    /**
     * Return the size of the pending queue
     */
    size() {
        return this.queue.length;
    }

    /**
     * Implements an iterator so instances of this class can use
     * the standard "for (const x of queue)" syntax
     */
    [Symbol.iterator]() {
        let index = -1;
        let data = this.queue;
        return {
            next: () => ({ value: data[++index], done: !(index in data) })
        };
    }
}

module.exports = PendingQueue;