import { describe, expect, it } from 'vitest';
import { backupsToPrune, suwayomiDecision } from '$lib/import/suwayomi';

const disk = (files: number, bytes = files * 100, newest = files) => ({ files, bytes, newest });

describe('when the Suwayomi timer imports', () => {
	it('never while something is queued or downloading', () => {
		expect(suwayomiDecision([{ state: 'DOWNLOADING' }], disk(3), null)).toMatchObject({
			kind: 'wait'
		});
		expect(suwayomiDecision([{ state: 'QUEUED' }], disk(3), null)).toMatchObject({ kind: 'wait' });
	});

	it('does not wait on finished items left in the queue', () => {
		expect(suwayomiDecision([{ state: 'FINISHED' }], disk(3), null)).toMatchObject({
			kind: 'import'
		});
	});

	it('once something arrived, and not again until more does', () => {
		expect(suwayomiDecision([], disk(3), null)).toEqual({ kind: 'import', fingerprint: disk(3) });
		expect(suwayomiDecision([], disk(3), disk(3))).toEqual({ kind: 'unchanged' });
		expect(suwayomiDecision([], disk(4), disk(3))).toMatchObject({ kind: 'import' });
	});

	it('notices one chapter swapped for another', () => {
		expect(suwayomiDecision([], disk(3, 300, 9), disk(3, 300, 3))).toMatchObject({
			kind: 'import'
		});
		expect(suwayomiDecision([], disk(3, 310, 3), disk(3, 300, 3))).toMatchObject({
			kind: 'import'
		});
	});

	it('says why it does nothing when Suwayomi is down or empty', () => {
		expect(suwayomiDecision(null, disk(3), null)).toMatchObject({ kind: 'none' });
		expect(suwayomiDecision([], disk(0), null)).toMatchObject({ kind: 'none' });
	});
});

describe('which backups the timer drops', () => {
	it('keeps its newest three and leaves Suwayomi’s own to their TTL', () => {
		const names = [
			'org.suwayomi.tachidesk._2026-10-03_17-35.tachibk',
			'org.suwayomi.tachidesk._2026-10-03_18-05.tachibk',
			'org.suwayomi.tachidesk._2026-10-02_09-00.tachibk',
			'org.suwayomi.tachidesk._2026-10-03_19-15.tachibk',
			'org.suwayomi.tachidesk.auto_2026-10-01_00-00.tachibk',
			'notes.txt'
		];
		expect(backupsToPrune(names)).toEqual(['org.suwayomi.tachidesk._2026-10-02_09-00.tachibk']);
		expect(backupsToPrune(names.slice(0, 2))).toEqual([]);
	});
});
