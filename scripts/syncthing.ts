import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from '../src/lib/server/fspath.ts';

/**
 * The local Syncthing's REST API (doc/SYNC.md), for the sync scripts. The
 * address and API key come from its own config file, so nothing is copied
 * into tsundoku's .env; the key is never printed.
 */

function configPath(): string {
	if (process.env.SYNCTHING_CONFIG) return process.env.SYNCTHING_CONFIG;
	const state = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
	return join(state, 'syncthing', 'config.xml');
}

function gui(): { base: string; key: string } {
	const xml = readFileSync(configPath(), 'utf8');
	const section = /<gui\b[^>]*>([\s\S]*?)<\/gui>/.exec(xml)?.[1] ?? '';
	const address = /<address>([^<]+)<\/address>/.exec(section)?.[1] ?? '127.0.0.1:8384';
	const key = /<apikey>([^<]+)<\/apikey>/.exec(section)?.[1];
	if (!key) throw new Error(`no API key in ${configPath()}`);
	const tls = /<gui\b[^>]*tls="true"/.test(xml);
	return { base: `${tls ? 'https' : 'http'}://${address}`, key };
}

export async function st<T>(path: string, init: RequestInit = {}): Promise<T> {
	const { base, key } = gui();
	const res = await fetch(`${base}${path}`, {
		...init,
		headers: { 'X-API-Key': key, 'content-type': 'application/json', ...init.headers }
	});
	if (!res.ok) throw new Error(`syncthing ${init.method ?? 'GET'} ${path}: ${res.status}`);
	const text = await res.text();
	return (text ? JSON.parse(text) : null) as T;
}

export type FolderConfig = { id: string; label: string; path: string; type: string };
