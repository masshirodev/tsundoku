/**
 * Gives tsundoku's engine what Suwayomi has (doc/DOWNLOADER.md, "Extensions";
 * card c136): the extension repositories the owner added there, and every
 * extension installed from them, each checked against its repository's
 * signing key and loaded into the engine. Run by hand, once, after the
 * deploy that brings rung 39 (doc/SERVING.md, "Who migrates"); running it
 * again installs what Suwayomi has gained since and leaves the rest.
 *
 *   yarn run engine-seed
 *
 * Not a repository tsundoku ships: these are the owner's own, read from
 * Suwayomi's settings. Needs SUWAYOMI_URL (and its login), ENGINE_URL and
 * ENGINE_TOKEN in .env.
 */
import { fileURLToPath } from 'node:url';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}
// A hand-run script never moves the schema (doc/SERVING.md, "Who migrates").
process.env.TSUNDOKU_MIGRATE = 'off';

const { suwayomiAuth } = await import('../src/lib/server/suwayomi-auth.ts');
const { engineConfigured } = await import('../src/lib/server/engine/client.ts');
const ext = await import('../src/lib/server/engine/extensions.ts');

const server = process.env.SUWAYOMI_URL;
if (!server || !engineConfigured()) {
	console.log(
		'engine-seed: needs SUWAYOMI_URL, ENGINE_URL and ENGINE_TOKEN in .env (doc/SECRETS.md)'
	);
	process.exit(1);
}

const res = await fetch(`${server}/api/graphql`, {
	method: 'POST',
	headers: { 'content-type': 'application/json', ...suwayomiAuth(server) },
	body: JSON.stringify({
		query:
			'{ settings { extensionRepos } extensions(condition: { isInstalled: true }) { nodes { pkgName name } } }'
	})
});
const { data } = (await res.json()) as {
	data: {
		settings: { extensionRepos: string[] };
		extensions: { nodes: { pkgName: string; name: string }[] };
	};
};

for (const address of data.settings.extensionRepos) {
	try {
		await ext.addRepo(address);
		console.log(`engine-seed: repository ${address}`);
	} catch (e) {
		console.log(`engine-seed: repository ${address} not added: ${(e as Error).message}`);
	}
}

const have = new Set(ext.installed().map((i) => i.pkg));
const listed = new Set(ext.listings().map((l) => l.pkg));
let installed = 0;
for (const { pkgName, name } of data.extensions.nodes) {
	if (have.has(pkgName)) continue;
	if (!listed.has(pkgName)) {
		console.log(`engine-seed: ${name}: no repository lists it`);
		continue;
	}
	try {
		await ext.install(pkgName);
		const i = ext.installed().find((x) => x.pkg === pkgName);
		console.log(
			`engine-seed: ${name} ${i?.versionName}${i?.failed ? ` (failed to load: ${i.failed})` : ''}`
		);
		installed++;
	} catch (e) {
		console.log(`engine-seed: ${name} not installed: ${(e as Error).message}`);
	}
}
console.log(`engine-seed: ${installed} installed, ${have.size} already there`);
