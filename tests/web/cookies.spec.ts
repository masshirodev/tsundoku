/**
 * Cookies in the web edition (web/cookies.js): the in-tab server's requests
 * carry the tab's cookies, and the cookies it sets survive a browser that drops
 * `Set-Cookie` from script-made responses. Node keeps `Set-Cookie`, so the
 * browser's dropping is stood in for by a scope whose Headers and Response
 * behave as a browser's do.
 */
import { describe, expect, it } from 'vitest';
import { forDocument, keepCookies, setCookiesOf, withCookie } from '../../web/cookies.js';

/** A global scope as a browser's: a response's headers drop Set-Cookie. */
function browserScope() {
	class GuardedHeaders extends Headers {
		guarded = false;
		append(name: string, value: string) {
			if (this.guarded && name.toLowerCase() === 'set-cookie') return;
			super.append(name, value);
		}
		set(name: string, value: string) {
			if (this.guarded && name.toLowerCase() === 'set-cookie') return;
			super.set(name, value);
		}
	}
	class BrowserResponse {
		headers: GuardedHeaders;
		constructor(_body?: unknown, init?: ResponseInit) {
			const h = new GuardedHeaders();
			h.guarded = true;
			// The browser copies its init's headers, dropping Set-Cookie.
			for (const [k, v] of new Headers(init?.headers)) h.append(k, v);
			this.headers = h;
		}
	}
	const scope = {
		Headers: GuardedHeaders,
		Response: BrowserResponse
	} as unknown as typeof globalThis;
	keepCookies(scope);
	return scope;
}

describe('the cookies the server sets', () => {
	it('survive kit appending them to a response the browser guards', () => {
		const g = browserScope();
		const res = new g.Response(null, { status: 303 });
		res.headers.append('set-cookie', 'tsundoku_theme=light; Path=/; HttpOnly');
		res.headers.append('set-cookie', 'b=2; Path=/');
		expect([...res.headers]).not.toContainEqual(expect.arrayContaining(['set-cookie']));
		expect(setCookiesOf(res.headers)).toEqual([
			'tsundoku_theme=light; Path=/; HttpOnly',
			'b=2; Path=/'
		]);
	});

	it('survive being given to a Response in its init, as an object, a list, or Headers', () => {
		const g = browserScope();
		const fromObject = new g.Response(null, { headers: { 'set-cookie': 'a=1', location: '/' } });
		expect(setCookiesOf(fromObject.headers)).toEqual(['a=1']);
		const fromList = new g.Response(null, { headers: [['Set-Cookie', 'b=2']] });
		expect(setCookiesOf(fromList.headers)).toEqual(['b=2']);
		const plain = new g.Headers();
		plain.append('set-cookie', 'c=3');
		expect(setCookiesOf(new g.Response(null, { headers: plain }).headers)).toEqual(['c=3']);
	});

	it('set replaces and delete forgets', () => {
		const g = browserScope();
		const res = new g.Response(null);
		res.headers.append('set-cookie', 'a=1');
		res.headers.set('Set-Cookie', 'b=2');
		expect(setCookiesOf(res.headers)).toEqual(['b=2']);
		res.headers.delete('set-cookie');
		expect(setCookiesOf(res.headers)).toEqual([]);
	});

	it('teaching a scope twice changes nothing', () => {
		const g = browserScope();
		keepCookies(g);
		const res = new g.Response(null);
		res.headers.append('set-cookie', 'a=1');
		expect(setCookiesOf(res.headers)).toEqual(['a=1']);
	});

	it('where the browser keeps them (Node), each is counted once', () => {
		keepCookies();
		const res = new Response(null, { headers: [['set-cookie', 'a=1']] });
		res.headers.append('set-cookie', 'b=2');
		expect(setCookiesOf(res.headers)).toEqual(['a=1', 'b=2']);
		expect(setCookiesOf(undefined)).toEqual([]);
	});
});

describe('the cookies a request carries', () => {
	it('the tab’s cookies become the request’s Cookie header', () => {
		const r = withCookie(new Request('https://t.test/'), 'tsundoku_theme=light; b=2');
		expect(r.headers.get('cookie')).toBe('tsundoku_theme=light; b=2');
	});

	it('none, and the request is left as it was', () => {
		const original = new Request('https://t.test/', { headers: { 'x-a': '1' } });
		expect(withCookie(original, '')).toBe(original);
		expect(original.headers.get('cookie')).toBeNull();
	});
});

describe('writing a cookie into the browser’s jar', () => {
	it('drops HttpOnly, which script cannot set, and keeps the rest', () => {
		expect(forDocument('tsundoku_reveal=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600')).toBe(
			'tsundoku_reveal=1; Path=/; SameSite=Lax; Max-Age=3600'
		);
	});
});
