# node-torrent
BitTorrent implementation in NodeJS. WIP.

The goal at the moment is simply to handle a download from several peers, and write that to a file.

Current progress:
- [x] Decode bencoded torrent file
- [x] Calculate file infohash
- [x] Request peers from tracker
- [x] Establish TCP connection with peers
- [x] Perform handshake with peers
- [] Request pieces from peers
- [] Download from peers
- [] Write to file