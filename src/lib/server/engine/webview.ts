import { readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from '../fspath.ts';
import { capabilities, engineConfigured, webviewStatus } from './client.ts';
import { readSwitch, writeSwitch } from './webview-switch.ts';
import {
	firstUseLine,
	stateLine,
	webviewMark,
	webviewSupport,
	type WebViewStatus,
	type WebViewSupport
} from '../../webview.ts';

/**
 * The engine's WebView, from the app's side (doc/EXTENSION-ENGINE.md,
 * "WebView support"; doc/SETTINGS.md, "07 — BROWSE"): whether this install's
 * engine runs WebView extensions, how its Chromium is, SETTINGS' switch, and
 * the folder Chromium lives in.
 *
 * The switch is the launcher's to apply. A release's launcher tells the app
 * where the switch is (`ENGINE_WEBVIEW_SWITCH`) and where Chromium goes
 * (`ENGINE_WEBVIEW_DIR`), reads the switch for every engine start, and
 * restarts the engine when it changes. Anywhere else (development's compose
 * engine, a test's fake) neither is set: the engine's own `ENGINE_WEBVIEW` is
 * what counts, and SETTINGS shows the switch without a control.
 */

/** The switch's file, where a release's launcher reads it; null elsewhere. */
export const switchFile = () => process.env.ENGINE_WEBVIEW_SWITCH || null;

/** Chromium's folder, where the launcher names it; null elsewhere. */
export const chromiumDir = () => process.env.ENGINE_WEBVIEW_DIR || null;

/** SETTINGS' switch: true or false where the launcher reads one, null where nothing does. */
export function switchOn(): boolean | null {
	const f = switchFile();
	return f ? readSwitch(f) : null;
}

// `/capabilities` changes only when the engine restarts: asked again after a
// few seconds, so a switch's restart shows soon, and a page with forty source
// rows asks once.
const CAPS_MS = 5_000;
let caps: { at: number; value: Record<string, unknown> | null } | null = null;

async function cachedCapabilities(now = Date.now()) {
	if (caps && now - caps.at < CAPS_MS) return caps.value;
	const value = await capabilities();
	caps = { at: now, value };
	return value;
}

/** Forgets the cached `/capabilities`: the switch was just changed. */
export const forgetCapabilities = () => {
	caps = null;
};

/** Whether this install's engine runs WebView extensions (`webviewSupport`). */
export async function support(): Promise<WebViewSupport> {
	if (!engineConfigured()) return 'unknown';
	return webviewSupport(await cachedCapabilities(), switchOn());
}

/** The mark an extension or source that uses a WebView carries here (`webviewMark`). */
export async function mark(): Promise<string> {
	return webviewMark(await support());
}

// Chromium's folder holds a few thousand files (359 MB): its size is counted
// once a minute at most, and again after a change.
const SIZE_MS = 60_000;
let sized: { dir: string; at: number; bytes: number | null } | null = null;

async function folderBytes(dir: string): Promise<number> {
	let total = 0;
	for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
		if (!e.isFile()) continue;
		try {
			total += (await stat(join(e.parentPath, e.name))).size;
		} catch {
			// Gone between the listing and the stat: Chromium updating its own files.
		}
	}
	return total;
}

/** Chromium's folder's size, or null when there's none (never downloaded, or removed). */
export async function chromiumBytes(now = Date.now()): Promise<number | null> {
	const dir = chromiumDir();
	if (!dir || !existsSync(dir)) return null;
	if (sized && sized.dir === dir && now - sized.at < SIZE_MS) return sized.bytes;
	const bytes = await folderBytes(dir).catch(() => null);
	sized = { dir, at: now, bytes: bytes || null };
	return sized.bytes;
}

export type WebViewView = {
	/** A release's launcher applies the switch; elsewhere it is shown, not set. */
	managed: boolean;
	/** SETTINGS' switch, where there is one. */
	on: boolean | null;
	support: WebViewSupport;
	/** The engine's `/webview`, or null when it didn't answer. */
	status: WebViewStatus | null;
	/** The switch and the engine disagree: the launcher is restarting the engine to take it. */
	restarting: boolean;
	/** SETTINGS' state line ("NOT NEEDED YET", "DOWNLOADING 40 %", ...). */
	line: string;
	/** The first-use line, while Chromium comes or after it failed; null otherwise. */
	firstUse: string | null;
	chromium: { dir: string | null; bytes: number | null };
};

/**
 * Everything SETTINGS' WEBVIEW row draws, and what a page waiting on a
 * WebView extension asks every couple of seconds (`/api/browse/webview`).
 */
export async function webviewView(): Promise<WebViewView> {
	const managed = switchFile() !== null;
	const on = switchOn();
	const [sup, status, bytes] = await Promise.all([
		support(),
		engineConfigured() ? webviewStatus() : Promise.resolve(null),
		chromiumBytes()
	]);
	// The engine answered, and says otherwise than the switch: the launcher
	// restarts it within a few seconds of the change.
	const running = status ? status.state !== 'off' : null;
	const restarting = managed && on !== null && running !== null && running !== on;
	return {
		managed,
		on,
		support: sup,
		status,
		restarting,
		line: stateLine(status, sup),
		firstUse: firstUseLine(status),
		chromium: { dir: chromiumDir() ?? status?.dir ?? null, bytes }
	};
}

/** SETTINGS' ON | OFF: false where nothing reads the switch. */
export function setWebView(on: boolean): boolean {
	const f = switchFile();
	if (!f) return false;
	writeSwitch(f, on);
	forgetCapabilities();
	return true;
}

/**
 * REMOVE: deletes the downloaded Chromium, which is all the WebView leaves on
 * disk (FORK.md). Only with the switch off and the engine not running it:
 * an engine still on (the restart not done yet) has the files open, and
 * would download them again at its next WebView extension. Refuses any
 * folder that isn't `…/webview/chromium`, so a mistaken variable can't
 * delete anything else. Returns why it refused, or null once removed.
 */
export async function removeChromium(): Promise<string | null> {
	const dir = chromiumDir();
	if (!dir || switchFile() === null) return 'nothing to remove here';
	if (basename(dir) !== 'chromium' || basename(dirname(dir)) !== 'webview')
		return 'not a WebView folder';
	if (switchOn()) return 'turn the WebView off first';
	const status = await webviewStatus();
	if (status && status.state !== 'off') return 'the engine is still restarting: try in a moment';
	await rm(dir, { recursive: true, force: true });
	sized = null;
	return null;
}
