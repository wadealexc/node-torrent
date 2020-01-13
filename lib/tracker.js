const EventEmitter = require('events');
const request = require('request');
const bencode = require('bencode');

/**
 * Represents a BitTorrent tracker which will provide us with a list of peers
 * to connect to.
 */
class Tracker extends EventEmitter {

    constructor (trackerURL) {
        super();
        this.trackerURL = trackerURL;

        // Announce our presence and begin requesting peers at regular intervals
        this._run();
    }

    // Request peers from the tracker and decode response
    _run() {
        // encoding: null allows us to handle binary data
        request.get({ url: this.trackerURL, encoding: null }, (err, resp, body) => {
            if (err) { throw err; }

            // Decode response from tracker
            // We expect at least these fields:
            // interval (int) - how many seconds should elapse before we request peers again
            // peers (binary blob) - a list of peers
            let response = bencode.decode(body);

            if (response['failure reason']) {
                throw 'Failed with message: ' + response['failure reason'].toString();
            }

            if (!response.interval) {
                throw 'Response did not contain an interval. Response: ' + response;
            }

            if (!response.peers) {
                throw 'Response did not contain peers. Response: ' + response;
            }

            // If the tracker gave us a new interval, emit event and update
            if (this.interval !== response.interval) {
                this.emit('new interval', response.interval);
                this.interval = response.interval;
            }
            
            // Decode list of peers from response and emit event
            let receivedPeers = unmarshalPeers(response.peers);
            this.emit('ready', receivedPeers);

            // Make another request after the interval
            // setTimeout(() => { this._run() }, this.interval * 1000);
        });
    }
}

/**
 * Peers are stored in groups of 6 bytes. The first four bytes are the IP address,
 * and the last 2 bytes make up the port.
 * @param {*} peerBuffer 
 */
function unmarshalPeers(peerBuffer) {
    const PEER_SIZE = 6;
    if (peerBuffer.length % PEER_SIZE !== 0) {
        throw 'Malformed peer buffer recieved';
    }

    let peerList = [];
    for (let i = 0; i < peerBuffer.length; i += PEER_SIZE) {
        let peer = {
            host: peerBuffer[i] + '.' + 
                peerBuffer[i + 1] + '.' + 
                peerBuffer[i + 2] + '.' + 
                peerBuffer[i + 3],
            port: peerBuffer.readUInt16BE(i + 4)
        }
        peerList.push(peer);
    }
    return peerList;
}

module.exports = Tracker;