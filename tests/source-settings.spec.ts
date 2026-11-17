import { describe, expect, it } from 'vitest';
import { settingOf, valueFromForm, type Setting } from '$lib/library/source-settings';

// Shapes as the engine answered preferencesManga for MangaDex, Asura and
// Omega Scans (doc/EXTENSION-ENGINE.md, "Preferences").
const list = {
	key: 'thumbnailQuality_en',
	listPreference: {
		title: 'Cover quality',
		summary: '%s',
		valueIndex: 1,
		entries: ['Original', 'Medium', 'Low'],
		entryValues: ['', '.512.jpg', '.256.jpg']
	}
};
const toggle = {
	key: 'dataSaverV5_en',
	switchPreferenceCompat: { title: 'Data saver', summary: 'Smaller images', value: true }
};
const text = {
	key: 'pref_user',
	editTextPreference: { title: 'Username/Email', summary: 'Ignored if empty.', value: '', text: '' }
};
const multi = {
	key: 'contentRating_en',
	multiSelectListPreference: {
		title: 'Content rating',
		summary: '',
		entries: ['Safe', 'Suggestive', 'Erotica'],
		entryValues: ['safe', 'suggestive', 'erotica'],
		values: ['safe', 'suggestive', 'gone']
	}
};

describe('reading a source’s settings', () => {
	it('reads each of the five types into one shape', () => {
		expect(settingOf(list)).toEqual({
			key: 'thumbnailQuality_en',
			title: 'Cover quality',
			summary: 'Medium',
			type: 'list',
			entries: ['Original', 'Medium', 'Low'],
			index: 1
		});
		expect(settingOf(toggle)).toMatchObject({ type: 'switch', on: true, title: 'Data saver' });
		expect(
			settingOf({ key: 'k', checkBoxPreference: { title: 'Box', value: false } })
		).toMatchObject({ type: 'check', on: false });
		expect(settingOf(text)).toMatchObject({ type: 'text', text: '' });
		// A value the source no longer offers isn't shown as chosen.
		expect(settingOf(multi)).toMatchObject({ type: 'multi', chosen: ['safe', 'suggestive'] });
	});

	it('drops what it can’t draw truthfully', () => {
		expect(settingOf({ key: 'x' })).toBeNull();
		expect(settingOf({ key: 'x', listPreference: { title: 'Empty', entries: [] } })).toBeNull();
		expect(settingOf({ key: 'x', seekBarPreference: { title: 'Unknown' } })).toBeNull();
		expect(
			settingOf({ key: 'x', multiSelectListPreference: { entries: ['A'], entryValues: [] } })
		).toBeNull();
	});
});

describe('a form’s answer', () => {
	const s = (p: { key: string } & Record<string, unknown>) => settingOf(p) as Setting;

	it('becomes the value setPreference stores', () => {
		expect(valueFromForm(s(toggle), ['false'])).toBe(false);
		expect(valueFromForm(s(list), ['2'])).toBe(2);
		expect(valueFromForm(s(text), ['me@example.org'])).toBe('me@example.org');
		expect(valueFromForm(s(multi), ['erotica', 'safe', 'safe'])).toEqual(['erotica', 'safe']);
		expect(valueFromForm(s(multi), [])).toEqual([]);
	});

	it('is refused when it isn’t one of the setting’s values', () => {
		expect(valueFromForm(s(toggle), ['maybe'])).toBeNull();
		expect(valueFromForm(s(list), ['3'])).toBeNull();
		expect(valueFromForm(s(list), ['-1'])).toBeNull();
		expect(valueFromForm(s(multi), ['pornographic'])).toBeNull();
		expect(valueFromForm(s(text), [])).toBeNull();
	});
});
