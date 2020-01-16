const fs = require('fs');
const bencode = require('bencode');
const sha1 = require('sha1');

const Tracker = require('./lib/tracker');
const DownloadManager = require('./lib/download-manager');

const PEER_ID = '556a1D0d4b0Df32dA6A49676beFa47cDF8f5F6c0';
const TORRENT_FILE = './torrents/debian-10.2.0-amd64-netinst.iso.torrent';

// Get file content and decode torrent file. We should have fields:
// announce (tracker url)
// comment (description of file)
// creation date
// info:
//// length (payload size)
//// name (name of file)
//// piece length (size of each 'piece' of the file)
//// pieces (a blob full of SHA-1 hashes of each piece)
let contentBuffer = fs.readFileSync(TORRENT_FILE);
let result = bencode.decode(contentBuffer);

// Calculate infoHash, which uniquely identifies the file we want to download.
// The tracker will use this to decide which peers to send us.
let infoHash = sha1(bencode.encode(result.info));
console.log('File infoHash:' + infoHash);

// Create URL string to send to tracker, requesting peers for the torrent
let trackerURL = result.announce.toString() + 
    '?info_hash=%' + infoHash.match(/.{1,2}/g).join('%') +
    '&peer_id=%' + PEER_ID.match(/.{1,2}/g).join('%') + 
    '&port=6881' + '&uploaded=0' + '&downloaded=0' +
    '&compact=1' + '&left=' + result.info.length;

// Create tracker and request peers
let tracker = new Tracker(trackerURL);
let downloadManager = new DownloadManager(result.info, PEER_ID, infoHash);

tracker.on('ready', (peers) => {
    console.log('Received ' + peers.length + ' peers from tracker.');
    downloadManager.startDownload(peers);
});