/**
 * What the launcher and the tray say to each other (doc/TRAY.md, "Talking to
 * the launcher"). The tray (`ops/release/tray/`, a Go program) runs
 * `launch.ts --tray` with no window, reads events from its stdout and writes
 * commands to its stdin. Pure, so the protocol is tested on both sides
 * (tests/launcher-tray.spec.ts here, `protocol_test.go` there).
 *
 * Events are one line each, `@tsundoku ` and a JSON object with `event`;
 * anything else on stdout is ignored by the tray (the launcher's own lines go
 * to logs/launcher.log in tray mode, never there).
 */

export const EVENT_PREFIX = '@tsundoku ';

export type TrayEvent =
	/** The data folder and its logs, once found (the tray's OPEN THE LOGS FOLDER). */
	| { event: 'home'; home: string; logs: string }
	/** The app answers here: the tray shows the address, and opens it on OPEN. */
	| { event: 'ready'; origin: string }
	/** Another tsundoku already answered here; the launcher exits 0 after this. */
	| { event: 'already'; origin: string }
	/** The app stopped by itself; the launcher exits `code` after this. */
	| { event: 'stopped'; code: number; log: string };

export type TrayCommand = 'open' | 'quit';

export const eventLine = (e: TrayEvent) => `${EVENT_PREFIX}${JSON.stringify(e)}\n`;

/** A line from the tray, or null for anything that isn't a command. */
export function command(line: string): TrayCommand | null {
	const c = line.trim();
	return c === 'open' || c === 'quit' ? c : null;
}

/**
 * Commands as they arrive on stdin, in chunks that need not end on a line:
 * whole lines handed to `on`, a partial one kept for the next chunk.
 */
export class CommandReader {
	private partial = '';
	private on: (c: TrayCommand) => void;

	constructor(on: (c: TrayCommand) => void) {
		this.on = on;
	}

	write(chunk: Buffer | string) {
		const lines = (this.partial + chunk.toString()).split(/\r?\n/);
		this.partial = lines.pop() ?? '';
		for (const l of lines) {
			const c = command(l);
			if (c) this.on(c);
		}
	}
}
