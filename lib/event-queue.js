const EventEmitter = require('events');

class EventQueue extends EventEmitter {

    constructor (arr) {
        super();
        this.queue = [];

        if (Array.isArray(arr)) {
            this.queue = arr;
        }
    }

    push(obj) {
        this.queue.push(obj);
        this.emit('push');
    }

    remove(obj) {
        let idx = this.queue.indexOf(obj);
        this.queue.splice(idx, 1);
    }

    size() {
        return this.queue.length;
    }

    isEmpty() {
        return this.queue.length === 0;
    }

    [Symbol.iterator]() {
        let index = -1;
        let data = this.queue;
        return {
            next: () => ({ value: data[++index], done: !(index in data) })
        };
    }
}

module.exports = EventQueue;