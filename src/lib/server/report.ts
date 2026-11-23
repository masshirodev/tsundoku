import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { version } from '$app/environment';
import { env } from '$env/dynamic/private';
import { dataPaths } from './data-dirs.ts';
import { getDb } from './db.ts';
import { join } from './fspath.ts';
import { currentLogin, friendLogin } from './auth.ts';
import { updateView } from './updates.ts';
import { HIDDEN_SQL } from './visibility.ts';
import { wifiStatus } from './wifi.ts';
import { scrub, type Scrub } from './report-scrub.ts';
import { knownSecrets } from './secrets.ts';

/**
 * SAVE A REPORT (SETTINGS › 05 — LIBRARY; doc/LOGS.md): one text
 * file a friend saves and sends when something breaks. Nothing is sent by
 * itself.
 *
 * Hidden means hidden, in a file that leaves the house most of all: the logs
 * are not trusted to be clean, so everything goes through `scrub` on the way
 * in. Secrets (tokens, cookies, pairing links), the data folder's and the
 * user's paths, and every hidden series' title and folder come out.
 */

const LOG_LINES = 300;

/** The last `n` lines of a file, or nothing. */
function tailOf(file: string, n: number): string {
	try {
		const lines = readFileSync(file, 'utf8').split(/\r?\n/);
		return lines.slice(-n - 1).join('\n');
	} catch {
		return '';
	}
}

/** What to take out: the secrets this process knows, and every hidden series. */
function scrubbing(): Scrub {
	const hidden = getDb()
		.prepare(
			`SELECT s.title, s.path FROM series s LEFT JOIN roots r ON r.id = s.root_id WHERE ${HIDDEN_SQL}`
		)
		.all() as { title: string; path: string }[];
	const hiddenRoots = getDb().prepare(`SELECT path FROM roots WHERE hidden = 1`).all() as {
		path: string;
	}[];
	const home = dataPaths().home;
	const user = process.env.USERPROFILE ?? process.env.HOME ?? '';
	return {
		secrets: knownSecrets(),
		hidden: [...hidden.flatMap((h) => [h.title, h.path]), ...hiddenRoots.map((r) => r.path)].filter(
			Boolean
		),
		paths: [
			[home, '<data>'],
			[user, '<user>']
		]
	};
}

/** The report, scrubbed whole. */
export async function buildReport(now = new Date()): Promise<string> {
	const home = dataPaths().home;
	const logs = join(home, 'logs');
	const wifi = wifiStatus();
	const updates = updateView();
	const login = currentLogin();
	let engine = 'not set';
	if (env.ENGINE_URL)
		engine = await fetch(`${env.ENGINE_URL.replace(/\/$/, '')}/capabilities`, {
			headers: env.ENGINE_TOKEN ? { authorization: `Bearer ${env.ENGINE_TOKEN}` } : {},
			signal: AbortSignal.timeout(3000)
		}).then(
			(r) => `answers (${r.status})`,
			(e: Error) => `not answering (${e.message})`
		);
	const lines = [
		`tsundoku report, ${now.toISOString()}`,
		'',
		`version     ${version}`,
		`system      ${platform()} ${release()} ${arch()}, node ${process.versions.node}`,
		`serving     ${env.TSUNDOKU_SERVE ?? 'https'}${friendLogin() ? `, sign-in: ${login?.kind ?? 'not set up'}` : ''}`,
		`wi-fi       ${wifi ? (wifi.on ? `on, ${wifi.listening.length ? 'listening' : 'no address'}` : 'off') : 'not here'}`,
		`updates     ${updates ? (updates.available ? `${updates.available.version} out` : 'up to date') : 'off'}${updates?.error ? `, last check failed: ${updates.error}` : ''}`,
		`engine      ${engine}`,
		`flaresolver ${env.ENGINE_SOLVER_URL ? 'installed' : 'not installed'}`,
		''
	];
	const files = existsSync(logs)
		? readdirSync(logs)
				.filter((f) => f.endsWith('.log'))
				.sort()
		: [];
	for (const f of files) {
		lines.push(
			`---------------- ${f}, last ${LOG_LINES} lines`,
			tailOf(join(logs, f), LOG_LINES),
			''
		);
	}
	if (!files.length) lines.push('(no logs folder: this install keeps no logs)');
	return scrub(lines.join('\n'), scrubbing());
}
