/**
 * A write lost in a takeover (src/lib/web/takeover.ts): answered as
 * SvelteKit's own refusal, so the screen stays and the layout's band says
 * NOTHING CHANGED with TRY AGAIN; anything else gets the plain 503.
 */
import { describe, expect, it } from 'vitest';
import { parse } from 'devalue';
import {
	LOST_TEXT,
	actionName,
	actionWords,
	isAction,
	lostAnswer,
	takenOver
} from '$lib/web/takeover';

const action = (url: string) =>
	new Request(url, { method: 'POST', headers: { 'x-sveltekit-action': 'true' }, body: 'a=1' });

describe('a request a takeover lost', () => {
	it('is answered, for a form action, as the failure use:enhance puts in page.form', async () => {
		const res = lostAnswer(action('https://t.test/?/newShelf'));
		expect(res.status).toBe(503);
		expect(res.headers.get('content-type')).toBe('application/json');
		const result = JSON.parse(await res.text());
		expect(result).toMatchObject({ type: 'failure', status: 503 });
		// SvelteKit's deserialize reads `data` with devalue.
		expect(parse(result.data)).toEqual({ lost: 'takeover', action: 'newShelf' });
	});

	it('is a plain 503 otherwise, a read or a post without enhance', async () => {
		for (const req of [
			new Request('https://t.test/api/x'),
			new Request('https://t.test/?/newShelf', { method: 'POST', body: 'a=1' })
		]) {
			const res = lostAnswer(req);
			expect(res.status).toBe(503);
			expect(await res.text()).toBe(LOST_TEXT);
		}
	});

	it('knows a form action by its method and SvelteKit’s header', () => {
		expect(isAction(action('https://t.test/?/x'))).toBe(true);
		expect(
			isAction(new Request('https://t.test/?/x', { headers: { 'x-sveltekit-action': 'true' } }))
		).toBe(false);
	});
});

describe('the band’s words for it', () => {
	it('names the action from its URL, empty for a page’s default action', () => {
		expect(actionName('https://t.test/?/newShelf')).toBe('newShelf');
		expect(actionName('https://t.test/series/3?/rate&x=1')).toBe('rate');
		expect(actionName('https://t.test/?/a%20b')).toBe('a b');
		expect(actionName('https://t.test/settings')).toBe('');
		expect(actionName('https://t.test/?q=1')).toBe('');
	});

	it('says it the way bands do', () => {
		expect(actionWords('newShelf')).toBe('NEW SHELF');
		expect(actionWords('undoSourceAdd')).toBe('UNDO SOURCE ADD');
		expect(actionWords('mark_read-all')).toBe('MARK READ ALL');
		expect(actionWords('')).toBe('');
	});

	it('reads the lost action out of page.form, and nothing else', () => {
		expect(takenOver({ lost: 'takeover', action: 'newShelf' })).toEqual({
			lost: 'takeover',
			action: 'newShelf'
		});
		expect(takenOver({ lost: 'takeover' })).toBeNull();
		expect(takenOver({ message: 'REFUSED' })).toBeNull();
		expect(takenOver(null)).toBeNull();
		expect(takenOver(undefined)).toBeNull();
	});
});
