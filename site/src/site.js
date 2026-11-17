// The page's only script (doc/WEBSITE.md, "The visitor's system"). Two jobs, both
// optional: the page as built is complete with JavaScript off.
//
// 1. Theme. The system's preference decides, in CSS. The header's cell
//    (/LIGHT or /DARK, the app's own search commands) overrides it for this
//    browser; the choice is kept in localStorage, which a private window or
//    blocked storage may refuse, so every access is guarded.
// 2. The visitor's system. Reorders 04 — DOWNLOAD so theirs leads, tags it
//    YOUR SYSTEM, gives its main button the accent, and renames the hero
//    button. order.js (inlined above this file by the build) holds the rules.
/* global detectOS, plan */

(function () {
	var KEY = 'tsundoku-site-theme';
	var root = document.documentElement;

	function stored() {
		try {
			var v = window.localStorage.getItem(KEY);
			return v === 'light' || v === 'dark' ? v : null;
		} catch {
			return null;
		}
	}
	/** @param {'light' | 'dark'} v */
	function store(v) {
		try {
			window.localStorage.setItem(KEY, v);
		} catch {
			/* the choice lasts this page only */
		}
	}
	function systemLight() {
		return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
	}
	function current() {
		var set = root.getAttribute('data-theme');
		if (set === 'light' || set === 'dark') return set;
		return systemLight() ? 'light' : 'dark';
	}

	// Before the body is parsed, so a stored choice never flashes the other palette.
	var saved = stored();
	if (saved) root.setAttribute('data-theme', saved);

	function ready() {
		/** @type {HTMLElement | null} */
		const button = document.querySelector('.bar-theme');
		if (button) {
			var label = function () {
				var next = current() === 'dark' ? 'light' : 'dark';
				button.textContent = '/' + next.toUpperCase();
				button.setAttribute('aria-label', 'Switch to the ' + next + ' theme');
			};
			label();
			button.hidden = false;
			button.addEventListener('click', function () {
				/** @type {'light' | 'dark'} */
				var next = current() === 'dark' ? 'light' : 'dark';
				root.setAttribute('data-theme', next);
				store(next);
				label();
			});
			if (window.matchMedia) {
				var mq = window.matchMedia('(prefers-color-scheme: light)');
				if (mq.addEventListener) mq.addEventListener('change', label);
			}
		}

		var os = detectOS(window.navigator);
		// iPadOS asks for desktop pages and calls itself a Mac; its touch screen gives it away. It is iOS, never a phone:
		// the APK is Android's.
		if (os === 'mac' && navigator.maxTouchPoints > 1) os = 'ios';
		const rows = document.querySelector('.dl-rows');
		if (!rows) return;
		var version = rows.getAttribute('data-version') || '';
		var apps = {
			app: !!rows.querySelector('[data-os="android"]'),
			tv: !!rows.querySelector('[data-os="android-tv"]')
		};
		var p = plan(os, version, apps);

		p.order.forEach(function (key) {
			var row = rows.querySelector('[data-os="' + key + '"]');
			if (!row) return;
			rows.appendChild(row);
			/** @type {HTMLElement | null} */
			var tag = row.querySelector('.tag');
			if (tag) tag.hidden = key !== p.mine;
		});
		var mains = rows.querySelectorAll('.btn-main');
		for (var i = 0; i < mains.length; i++) {
			mains[i].classList.toggle('btn-accent', mains[i].getAttribute('data-main') === p.accent);
		}

		/** @type {HTMLElement | null} */
		var band = document.querySelector('.dl-band');
		if (band) band.hidden = !p.phoneBand;
		var hero = document.getElementById('hero-download');
		if (hero) hero.textContent = p.hero;
		var meta = document.getElementById('hero-meta');
		if (meta) meta.textContent = p.meta;
		root.setAttribute('data-os', os);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
	else ready();
})();
