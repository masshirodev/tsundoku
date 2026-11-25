// Serves build-web/ for looking at the web edition locally:
// `yarn run serve:web`, then http://localhost:42160/. Plain static files: the
// app's server runs in the tab (doc/WEB-EDITION.md).
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = normalize(join(import.meta.dirname, '..', 'build-web'));
const port = Number(process.env.PORT ?? 42160);
const types = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.webmanifest': 'application/manifest+json',
	'.jar': 'application/java-archive'
};

createServer((req, res) => {
	const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	let file = normalize(join(root, path === '/' ? 'index.html' : path));
	if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory())
		file = join(root, 'index.html');
	res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
	res.setHeader('Accept-Ranges', 'bytes');
	// CheerpJ reads the engine's jar by byte ranges, as any static host serves them.
	const size = statSync(file).size;
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
	if (range && (range[1] !== '' || range[2] !== '')) {
		const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
		const end =
			range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (start >= size || start > end) {
			res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
			return;
		}
		res.writeHead(206, {
			'Content-Range': `bytes ${start}-${end}/${size}`,
			'Content-Length': String(end - start + 1)
		});
		createReadStream(file, { start, end }).pipe(res);
		return;
	}
	res.setHeader('Content-Length', String(size));
	createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`web edition on http://localhost:${port}/`));
