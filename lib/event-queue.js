const EventEmitter = require('events');

/**
 * A wrapper around standard arrays that emits a 'push' event when pushed to.
 * 
 * I use this so the DownloadManager knows when a peer is pushed
 * into the 'unemployed' queue. (It then assigns the peer work)
 */
class EventQueue extends EventEmitter {

    /**
     * @param {*} arr (optional) initial value of the queue
     */
    constructor (arr) {
        super();
        this.queue = [];

        if (Array.isArray(arr)) {
            this.queue = arr;
        }
    }

    /**
     * Push an object to the end of the queue and emit 'push'
     */
    push(obj) {
        this.queue.push(obj);
        this.emit('push');
    }

    /**
     * Pop an object off the queue and return it
     */
    pop() {
        return this.queue.pop();
    }

    /**
     * Search for an object in the queue and remove it
     */
    remove(obj) {
        let idx = this.queue.indexOf(obj);
        this.queue.splice(idx, 1);
    }

    /**
     * Returns true if the object exists in the queue
     */
    contains(obj) {
        return this.queue.indexOf(obj) !== -1;
    }

    /**
     * Returns the size of the queue
     */
    size() {
        return this.queue.length;
    }

    /**
     * Returns whether the queue is empty
     */
    isEmpty() {
        return this.queue.length === 0;
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

module.exports = EventQueue;