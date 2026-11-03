/**
 * Serves site/build/ on localhost, for looking at the page and for
 * site/test/site.e2e.ts. Caddy serves the real thing; this only has to answer
 * the same files with the right types.
 *
 *   yarn run site:serve [port]     # default 42150
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'build');
const port = Number(process.argv[2] ?? process.env.SITE_PORT ?? 42150);

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json',
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.woff2': 'font/woff2'
};

createServer((req, res) => {
	const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
	const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
	if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
		res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
		return;
	}
	res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
	createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`site: http://localhost:${port}/`));
