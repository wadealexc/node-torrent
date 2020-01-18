const fs = require('fs');
const EventEmitter = require('events');
const debug = require('debug')('piece-collector');

/**
 * As we download pieces from peers, this collects them in a fixed-length
 * array. When all pieces have been collected, they are written to a file.
 */
class PieceCollector extends EventEmitter {

    /**
     * Creates a file to collect pieces in
     * @param {*} numPieces The number of pieces to expect
     * @param {*} pieceSize The size of each piece of the file
     * @param {*} file The name of the file pieces will be downloaded to
     */
    constructor (numPieces, pieceSize, file) {
        super();

        this.numPieces = numPieces;
        this.pieceSize = pieceSize;

        this.fileName = './default';
        if (typeof file === 'string') {
            this.fileName = file;
        }

        this.piecesCollected = 0;
        this.collection = new Array(numPieces);

        // Create a writable stream to the file
        this.fStream = fs.createWriteStream(file);
        this.curPtr = 0;

        this.fStream.on('error', (err) => {
            throw err;
        });
    }

    /**
     * Returns whether or not the collector has collected a piece
     * @param {*} index The index of the piece
     */
    contains(index) {
        return this.collection[index] !== undefined;
    }

    /**
     * Returns whether or not all pieces have been collected
     */
    isComplete() {
        return this.piecesCollected === this.numPieces;
    }

    /**
     * Returns percent of pieces collected (rounds to 2 decimals)
     */
    percentComplete() {
        return Math.round(100 * (100 * this.piecesCollected / this.numPieces)) / 100;
    }

    /**
     * Collects a piece. If the piece has already been collected, simply ignores it.
     * @param {*} index The index of the piece
     * @param {*} buff The downloaded piece
     */
    collect(index, buff) {
        if (index >= this.numPieces) {
            throw 'index out of bounds:' + index;
        }

        if (!this.collection[index]) {
            this.collection[index] = buff;
            this.piecesCollected++;

            debug('collected #%d. Total %d of %d complete', index, this.piecesCollected, this.numPieces);

            // If we've collected all the pieces, write to file
            if (this.piecesCollected === this.numPieces) {
                this.emit('collection complete');
                this.write();
            }
        }
    }

    /**
     * Write all pieces to file
     */
    write() {
        let ok = true;
        do {
            let data = this.collection[this.curPtr];
            this.curPtr++;
            // fStream.write returns false if we should wait before writing the next piece
            // since we're writing a lot of data, we'll respect the stream's wishes.
            ok = this.fStream.write(data);
        } while (this.curPtr < this.numPieces && ok);

        // Had to stop early, start again when stream drains
        if (this.curPtr !== this.numPieces) {
            // 'drain' emitted once we're clear to write more
            this.fStream.once('drain', () => {
                this.write();
            });
        } else {
            debug('all pieces written to file');
            this.emit('write complete');
        }
    }
}

module.exports = PieceCollector;