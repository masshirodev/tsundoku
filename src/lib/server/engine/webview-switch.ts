import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from '../fspath.ts';

/**
 * SETTINGS' WEBVIEW switch, one per install (doc/SETTINGS.md, "07 — BROWSE";
 * doc/EXTENSION-ENGINE.md, "WebView support"). Off by default: the engine's
 * WebView runs sites' scripts in Chromium 111 without a sandbox, so the owner
 * decided (2026-11-12, card c978) that it is on only where an install turns
 * it on, the owner's own workstation, and off on friends'.
 *
 * Kept as a file in the data folder, `engine/webview.json`, as WI-FI keeps
 * `wifi.json`, because the launcher has to read it before the engine starts
 * and has no database. The app writes it; the launcher reads it on every
 * engine start, and watches it, restarting the engine when it changes
 * (ops/release/launcher/launch.ts). Where it is, and what the engine is
 * started with, are the launcher's plan's (`switchPath`, `engineWebViewEnv`);
 * the app is told the path as `ENGINE_WEBVIEW_SWITCH`. Shared by both, so
 * plain Node: no `$lib`, and nothing Node's type stripping can't load.
 */

/** Whether the switch says on. A missing or unreadable file is off, the default. */
export function readSwitch(file: string): boolean {
	try {
		return (JSON.parse(readFileSync(file, 'utf8')) as { on?: unknown }).on === true;
	} catch {
		return false;
	}
}

/** Turns it on or off: written whole and renamed, so the launcher never reads half a file. */
export function writeSwitch(file: string, on: boolean, now = Date.now()): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.part`;
	writeFileSync(tmp, `${JSON.stringify({ on, at: now })}\n`);
	renameSync(tmp, file);
}
