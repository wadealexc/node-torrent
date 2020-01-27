# node-torrent
BitTorrent in NodeJS. Only implements enough of the original 2001 spec to handle downloads.

## Running:

`git clone https://github.com/wadeAlexC/node-torrent`

`cd node-torrent`

`npm i`

`node index.js`

By default, downloads a torrent of Debian 10.2.0. Use `-t` to specify an alternative torrent to download. Use `-f` to specify the name of the file to output once downloading is complete.

### Debugging:

`DEBUG=* node index.js`

### Current progress:
- [x] Decode bencoded torrent file
- [x] Calculate file infohash
- [x] Request peers from tracker
- [x] Establish TCP connection with peers
- [x] Perform handshake with peers
- [x] Receive bitfield from peers
- [x] Request pieces from peers
- [x] Download from peers
- [x] Write to file
- [x] Add CLI and output

## How to explore this codebase:

For an intro into the BitTorrent protocol: https://blog.jse.li/posts/torrent/

The original spec: https://www.bittorrent.org/beps/bep_0003.html

Helpful alternate implementation in Node: https://github.com/webtorrent/webtorrent


Hopefully code comments can help with the rest!

Start in `index.js`. From there, `tracker.js` sets up a connection with the tracker specified in the torrent file. After receiving peers from the tracker, `download-manager.js` takes over and does most of the heavy lifting.

`download-manager` manages the jobs assigned to all peers through a few queues:

* `unclaimed`: Incomplete work that has not been assigned to a peer.
* `pending`: Active jobs currently assigned to a peer.
* `unemployed`: Peers that have not been assigned work.

Each time a peer completes a job, their active listing in `pending` is removed, and the peer is pushed to `unemployed`. When peers are pushed to `unemployed`, a listener calls `download-manager._assignWork()`. It iterates over each `unemployed` peer and assigns them work. Assignments come from `unclaimed` work, as we want peers to all be working on different jobs. But near the end of a download, we often don't have any `unclaimed` work to give to a peer. In this case, we assign peers work from `pending`. This means that many peers are downloading the same piece of the file, and helps ensure that no single, slow peer will throttle our download speed.

`peer.js` represents an active connection with a peer. `download-manager` initiates this connection in `download-manager.addPeers(peers)`, by calling the `peer` constructor. The constructor initiates a TCP connection with the peer, then attempts to complete a BitTorrent handshake. From that point, each time the peer sends us data, `peer._readAndProcessMessages` is called. The function first expects the peer to send a bitfield, a structure that represents the indices of file pieces the peer can provide us. After that, the function handles a few types of messages:
 * `UNCHOKE`: The peer has unchoked us and we can start requesting data
 * `CHOKE`: The peer has choked us and we should not send more requests
 * `HAVE`: The peer is telling us they have some piece of the file, so we update the peer's bitfield to reflect this.
 * `PIECE`: The peer has sent us a part of a file piece. Pieces are downloaded in ~16KB chunks and collected in a buffer until the entire piece has been downloaded. Once this happens, `peer._finalizeDownload()` is called and `download-manager` will be prompted to add the peer back to `unemployed`.
 
As pieces of the file are downloaded, they are validated in `download-manager` by checking the hash of the downloaded piece against the piece hash specified in the original torrent file. If the hashes are a match, the downloaded piece is sent to `piece-collector.js`, which holds all of the downloaded pieces in memory until it has received a piece for each index of the file. At this point, it emits `'collection complete'`, signalling the `download-manager` to disconnect from all peers. Finally, it writes all the pieces to file in `piece-collector.write()`.
