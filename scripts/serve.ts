/**
 * Serve the built app on the tailnet.
 *
 *   yarn run build && yarn run serve
 *
 * This wrapper exists because `node build` is one forgotten variable away from
 * being wrong in a way that does not announce itself. adapter-node defaults to
 * 0.0.0.0, and this box has no firewall active, so the default publishes the
 * library to the LAN. And an unset ORIGIN 403s every mutating request, so
 * the app loads perfectly on the phone and then no rating saves.
 *
 * Both are decided here, from one resolved address, before the server is
 * imported -- adapter-node reads its environment at module load.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BindRefused, originFor, resolveBindHost } from '../src/lib/server/bind.ts';

const root = new URL('../', import.meta.url);
const entry = new URL('build/index.js', root);

// A plain node process gets none of Vite's .env loading, and the token lives
// there. Shell variables still win: loadEnvFile does not overwrite them.
try {
	process.loadEnvFile(fileURLToPath(new URL('.env', root)));
} catch {
	// Absent .env is not fatal on its own -- the token check below says so better.
}

if (!existsSync(entry)) {
	console.error('no build/ found. Run `yarn run build` first.');
	process.exit(1);
}

if (!process.env.TSUNDOKU_TOKEN) {
	console.error(
		'TSUNDOKU_TOKEN is not set. Generate one into .env:\n' +
			'  echo "TSUNDOKU_TOKEN=$(node -e \'console.log(require("crypto").randomBytes(18).toString("base64url"))\')" >> .env'
	);
	process.exit(1);
}

let bind;
try {
	bind = resolveBindHost({
		requested: process.env.HOST,
		allowAny: process.env.TSUNDOKU_BIND_ANY === '1'
	});
} catch (e) {
	if (e instanceof BindRefused) {
		console.error(e.message);
		process.exit(1);
	}
	throw e;
}

const port = Number(process.env.PORT ?? 42143);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error(`PORT=${process.env.PORT} is not a usable port.`);
	process.exit(1);
}

const origin = process.env.ORIGIN ?? originFor(bind.host, port);

process.env.HOST = bind.host;
process.env.PORT = String(port);
process.env.ORIGIN = origin;
process.env.NODE_ENV = 'production';

const note =
	bind.source === 'tailnet'
		? 'tailnet address, auto-detected'
		: bind.source === 'wildcard-override'
			? 'WILDCARD -- reachable from the whole LAN, not just the tailnet'
			: 'from HOST';

console.log(`tsundoku  ${origin}  (${note})`);

await import(entry.href);
