import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectOS, plan, STATIC_ORDER } from '../src/order.js';

const ua = (userAgent: string, userAgentData?: { platform?: string; mobile?: boolean }) => ({
	userAgent,
	userAgentData
});

test('the visitor’s system, from the user agent', () => {
	assert.equal(detectOS(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')), 'windows');
	assert.equal(detectOS(ua('Mozilla/5.0 (X11; Linux x86_64)')), 'linux');
	assert.equal(detectOS(ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')), 'mac');
	assert.equal(detectOS(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')), 'phone');
	assert.equal(detectOS(ua('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')), 'linux');
	assert.equal(detectOS(ua('Something else')), 'none');
	assert.equal(detectOS(undefined), 'none');
});

test('Android says Linux, and counts as a phone', () => {
	assert.equal(detectOS(ua('Mozilla/5.0 (Linux; Android 14; Pixel 7)')), 'phone');
	assert.equal(
		detectOS(ua('Mozilla/5.0 (X11; Linux x86_64)', { platform: 'Android', mobile: true })),
		'phone'
	);
});

test('userAgentData’s platform wins where Chromium offers it', () => {
	assert.equal(detectOS(ua('Mozilla/5.0', { platform: 'Windows', mobile: false })), 'windows');
	assert.equal(detectOS(ua('Mozilla/5.0', { platform: 'macOS', mobile: false })), 'mac');
	assert.equal(detectOS(ua('Mozilla/5.0', { platform: 'Linux', mobile: false })), 'linux');
});

test('no JavaScript: the static order, no tag, the Windows installer on the accent', () => {
	const p = plan('none', '2026.11.01.2');
	assert.deepEqual(p.order, STATIC_ORDER);
	assert.equal(p.mine, null);
	assert.equal(p.accent, 'windows');
	assert.equal(p.hero, '↓ DOWNLOAD');
	assert.equal(p.meta, 'VERSION 2026.11.01.2 · WINDOWS AND LINUX · FREE');
	assert.equal(p.phoneBand, false);
});

test('Windows leads, tagged, the hero naming it', () => {
	const p = plan('windows', 'v');
	assert.deepEqual(p.order, ['windows', 'linux', 'mac']);
	assert.equal(p.mine, 'windows');
	assert.equal(p.accent, 'windows');
	assert.equal(p.hero, '↓ DOWNLOAD FOR WINDOWS');
});

test('Linux leads and takes the accent', () => {
	const p = plan('linux', 'v');
	assert.deepEqual(p.order, ['linux', 'windows', 'mac']);
	assert.equal(p.mine, 'linux');
	assert.equal(p.accent, 'linux');
	assert.equal(p.hero, '↓ DOWNLOAD FOR LINUX');
});

test('macOS leads, tagged, with no accent anywhere: nothing there is theirs', () => {
	const p = plan('mac', 'v');
	assert.deepEqual(p.order, ['mac', 'windows', 'linux']);
	assert.equal(p.mine, 'mac');
	assert.equal(p.accent, null);
	assert.equal(p.hero, '↓ DOWNLOAD');
	assert.equal(p.meta, 'WINDOWS AND LINUX · NOT YET FOR MACOS');
});

test('a phone: the band, the static order, nothing tagged', () => {
	const p = plan('phone', 'v');
	assert.deepEqual(p.order, STATIC_ORDER);
	assert.equal(p.mine, null);
	assert.equal(p.phoneBand, true);
	assert.equal(p.meta, 'FOR A COMPUTER · WINDOWS AND LINUX');
});

test('plan never shares its order with the static one', () => {
	const p = plan('none', 'v');
	p.order.reverse();
	assert.deepEqual(STATIC_ORDER, ['windows', 'linux', 'mac']);
});
