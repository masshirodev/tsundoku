import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	CommandReader,
	command,
	EVENT_PREFIX,
	eventLine,
	type TrayCommand
} from '../ops/release/launcher/tray.ts';

/**
 * The launcher's half of what it and the tray say to each other
 * (doc/TRAY.md, "Talking to the launcher"). The tray's half, in Go, parses
 * the same lines in ops/release/tray/misc_test.go (TestParseEvent).
 */
describe('the launcher and the tray', () => {
	it('writes each event as one prefixed line of JSON', () => {
		expect(eventLine({ event: 'ready', origin: 'http://localhost:42143' })).toBe(
			'@tsundoku {"event":"ready","origin":"http://localhost:42143"}\n'
		);
		expect(eventLine({ event: 'stopped', code: 3, log: '/h/logs/tsundoku.log' })).toBe(
			'@tsundoku {"event":"stopped","code":3,"log":"/h/logs/tsundoku.log"}\n'
		);
	});

	it('uses the prefix the tray looks for', () => {
		const go = readFileSync(new URL('../ops/release/tray/protocol.go', import.meta.url), 'utf8');
		expect(go).toContain(`const eventPrefix = "${EVENT_PREFIX}"`);
		for (const c of ['open', 'quit']) expect(go).toContain(`"${c}"`);
	});

	it('takes only its two commands', () => {
		expect(command('open')).toBe('open');
		expect(command('quit\r')).toBe('quit');
		expect(command('  quit  ')).toBe('quit');
		expect(command('exit')).toBeNull();
		expect(command('')).toBeNull();
	});

	it('reads commands from chunks that split lines', () => {
		const got: TrayCommand[] = [];
		const r = new CommandReader((c) => got.push(c));
		r.write('op');
		expect(got).toEqual([]);
		r.write('en\r\nnonsense\nqu');
		expect(got).toEqual(['open']);
		r.write(Buffer.from('it\n'));
		expect(got).toEqual(['open', 'quit']);
	});
});
