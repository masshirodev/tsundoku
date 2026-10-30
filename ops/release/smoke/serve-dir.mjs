// The release host, played by the test machine (smoke/windows-update.ps1):
// a folder's files over http on loopback, nothing else.
//
//   node serve-dir.mjs <folder> <port>
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize } from 'node:path';

const [root, port] = process.argv.slice(2);
createServer((req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (path.includes('..')) return res.writeHead(400).end();
	const file = join(root, path);
	let size;
	try {
		size = statSync(file).size;
	} catch {
		return res.writeHead(404).end('not here');
	}
	res.writeHead(200, { 'content-length': size });
	createReadStream(file).pipe(res);
}).listen(Number(port), '127.0.0.1');
