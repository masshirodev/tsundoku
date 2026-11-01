/**
 * HELP's topics (doc/HELP.md; card c208; the HELP handoff,
 * `doc/design/handoff/Help*.dc.html`): data, not prose files, because each
 * topic has a shape (an In short of three lines, numbered parts, a ruled table
 * where a part explains a screen's words), and a "?" opens the same In short
 * in a sheet: one source for both, so the sheet and the page can't drift.
 *
 * Series kept private, and the way to show them, are never mentioned here
 * (the owner's rule), and a test holds it (tests/help-domain.spec.ts). The
 * words are written for friends, not the owner, in the reader's language
 * (doc/I18N.md): `topics()` builds them per call, never at import.
 */

import { m } from '../paraglide/messages.js';
import { upper } from '../i18n/format.ts';

export type HelpPart = {
	/** The anchor a "?" opens the page at. */
	id: string;
	title: string;
	link?: { label: string; href: string };
	/** The label's right side when it isn't a link. */
	right?: string;
	paras?: string[];
	/** A ruled table: a screen's word, then what it does. */
	table?: [string, string][];
};

/** Where GET STARTED walks through a topic (FirstRead board 4C): a bold line under IN SHORT. */
export type HelpPointer = { text: string; label: string; href: string };

export type HelpTopic = {
	slug: string;
	n: string;
	title: string;
	/** The one word ← and → name it by, at a topic's end. */
	word: string;
	/** What the index row and the topic's head name: its parts. */
	meta: string;
	/** IN SHORT: three lines at most, a sentence each. */
	short: string[];
	pointer?: HelpPointer;
	parts: HelpPart[];
};

/** What an install is, for a topic that can't apply on it (board 1E). */
export type HelpPlace = { updater: boolean; overWifi: boolean };

export function topics(): HelpTopic[] {
	const settings = m.name_settings();
	const devices = m.name_devices_section();
	const browse = m.name_browse();
	const extensions = m.name_extensions();
	return [
		{
			slug: 'start',
			word: m.help_start_word(),
			n: '01',
			title: m.help_start_title(),
			meta: m.help_start_meta(),
			short: [m.help_start_short_1(), m.help_start_short_2(), m.help_start_short_3()],
			parts: []
		},
		{
			slug: 'reading',
			word: m.help_reading_word(),
			n: '02',
			title: m.help_reading_title(),
			meta: m.help_reading_meta(),
			short: [m.help_reading_short_1(), m.help_reading_short_2(), m.help_reading_short_3()],
			parts: [
				{
					id: 'turning',
					title: m.help_reading_turning_title(),
					table: [
						[m.help_reading_turning_edges(), m.help_reading_turning_edges_what()],
						[m.help_reading_turning_swipe(), m.help_reading_turning_swipe_what()],
						[m.help_reading_turning_middle(), m.help_reading_turning_middle_what()],
						[m.help_reading_turning_keys(), m.help_reading_turning_keys_what()]
					]
				},
				{
					id: 'strip',
					title: m.help_reading_strip_title(),
					link: { label: `${settings} →`, href: '/settings?section=reading' },
					paras: [
						m.help_reading_strip_para_1(),
						m.help_reading_strip_para_2({ settings, reading: m.name_reading_section() })
					]
				},
				{
					id: 'screen',
					title: m.help_reading_screen_title(),
					paras: [m.help_reading_screen_para_1(), m.help_reading_screen_para_2()]
				}
			]
		},
		{
			slug: 'downloading',
			word: m.help_downloading_word(),
			n: '03',
			title: m.help_downloading_title(),
			meta: m.help_downloading_meta({ browse, extensions }),
			short: [
				m.help_downloading_short_1(),
				m.help_downloading_short_2({ browse }),
				m.help_downloading_short_3()
			],
			pointer: {
				text: m.help_downloading_pointer({ start: m.name_get_started() }),
				label: m.help_downloading_pointer_go(),
				href: '/start#first-read'
			},
			parts: [
				{
					id: 'extensions',
					title: m.help_downloading_extensions_title(),
					link: { label: `${extensions} →`, href: '/browse/extensions?tab=repos' },
					paras: [
						m.help_downloading_extensions_para_1(),
						m.help_downloading_extensions_para_2({
							extensions,
							repositories: m.name_repositories_tab(),
							available: m.name_available_tab()
						})
					]
				},
				{
					id: 'online',
					title: m.help_downloading_online_title(),
					link: { label: `${browse} →`, href: '/browse' },
					paras: [m.help_downloading_online_para({ browse, history: m.name_history() })]
				},
				{
					id: 'download',
					title: m.help_downloading_download_title(),
					right: m.help_downloading_download_right(),
					table: [
						[m.help_downloading_download_add(), m.help_downloading_download_add_what()],
						[m.help_downloading_download_first(), m.help_downloading_download_first_what()],
						[m.help_downloading_download_all(), m.help_downloading_download_all_what()],
						[m.help_downloading_download_follow(), m.help_downloading_download_follow_what()]
					],
					paras: [m.help_downloading_download_para()]
				},
				{
					id: 'queue',
					title: m.help_downloading_queue_title(),
					link: { label: `${m.name_downloads()} →`, href: '/downloads' },
					paras: [m.help_downloading_queue_para({ downloads: m.name_downloads() })]
				}
			]
		},
		{
			slug: 'phone',
			word: m.help_phone_word(),
			n: '04',
			title: m.help_phone_title(),
			meta: m.help_phone_meta(),
			short: [m.help_phone_short_1(), m.help_phone_short_2(), m.help_phone_short_3()],
			parts: [
				{
					id: 'wifi',
					title: m.help_phone_wifi_title(),
					link: { label: `${settings} →`, href: '/settings#s-devices' },
					paras: [m.help_phone_wifi_para_1({ settings, devices }), m.help_phone_wifi_para_2()],
					table: [
						[m.help_phone_wifi_works(), m.help_phone_wifi_works_what()],
						[m.help_phone_wifi_doesnt(), m.help_phone_wifi_doesnt_what()]
					]
				},
				{
					id: 'tailscale',
					title: m.help_phone_tailscale_title(),
					paras: [m.help_phone_tailscale_para({ settings, devices })],
					table: [
						['1', m.help_phone_tailscale_step_1()],
						['2', m.help_phone_tailscale_step_2()],
						['3', m.help_phone_tailscale_step_3()],
						['4', m.help_phone_tailscale_step_4()]
					]
				}
			]
		},
		{
			slug: 'updates',
			word: m.help_updates_word(),
			n: '05',
			title: m.help_updates_title(),
			meta: m.help_updates_meta(),
			short: [
				m.help_updates_short_1({ settings, devices }),
				m.help_updates_short_2(),
				m.help_updates_short_3()
			],
			parts: [
				{
					id: 'shows',
					title: m.help_updates_shows_title(),
					link: { label: `${settings} →`, href: '/settings#s-devices' },
					paras: [m.help_updates_shows_para()]
				},
				{
					id: 'unzipped',
					title: m.help_updates_unzipped_title(),
					paras: [m.help_updates_unzipped_para()]
				}
			]
		},
		{
			slug: 'backups',
			word: m.help_backups_word(),
			n: '06',
			title: m.help_backups_title(),
			meta: m.help_backups_meta(),
			short: [m.help_backups_short_1(), m.help_backups_short_2(), m.help_backups_short_3()],
			parts: [
				{
					id: 'folder',
					title: m.help_backups_folder_title(),
					link: { label: `${m.name_get_started()} →`, href: '/start' },
					table: [
						['MIHON', m.help_backups_folder_mihon_what()],
						['EPUB', m.help_backups_folder_epub_what()],
						[m.help_backups_folder_not_yet(), m.help_backups_folder_not_yet_what()]
					],
					paras: [m.help_backups_folder_para({ more: m.name_more() })]
				}
			]
		},
		{
			slug: 'report',
			word: m.help_report_word(),
			n: '07',
			title: m.help_report_title(),
			meta: m.help_report_meta(),
			short: [
				m.help_report_short_1({ settings, library: m.name_library_section() }),
				m.help_report_short_2(),
				m.help_report_short_3()
			],
			parts: [
				{
					id: 'save',
					title: m.help_report_save_title(),
					link: { label: `${settings} →`, href: '/settings?section=library' },
					paras: [m.help_report_save_para()]
				}
			]
		}
	];
}

export const topicBySlug = (slug: string) => topics().find((t) => t.slug === slug) ?? null;

/** The topic before and after, for ← and → at a topic's end. */
export function neighbours(slug: string): { prev: HelpTopic | null; next: HelpTopic | null } {
	const all = topics();
	const i = all.findIndex((t) => t.slug === slug);
	return { prev: i > 0 ? all[i - 1] : null, next: i >= 0 ? (all[i + 1] ?? null) : null };
}

/** A topic that can't apply on this install: its band, or null (board 1E). The topic still opens. */
export function notHere(slug: string, at: HelpPlace): { a: string; b: string } | null {
	if (slug === 'updates' && !at.updater)
		return { a: m.help_not_here_updates_a(), b: m.help_not_here_updates_b() };
	if (slug === 'phone' && at.overWifi)
		return { a: m.help_not_here_phone_a(), b: m.help_not_here_phone_b() };
	return null;
}

/** A "?"'s sheet: the topic's In short, and where WHOLE TOPIC → lands. */
export function ask(
	slug: string,
	part?: string
): {
	topic: HelpTopic;
	part: HelpPart | null;
	href: string;
	at: string;
} {
	const topic = topicBySlug(slug)!;
	const p = part ? (topic.parts.find((x) => x.id === part) ?? null) : null;
	const i = p ? topic.parts.indexOf(p) : -1;
	return {
		topic,
		part: p,
		href: `/help/${topic.slug}${p ? `#${p.id}` : ''}`,
		at: p
			? m.help_opens_at({ n: String(i + 1).padStart(2, '0'), title: p.title })
			: m.help_opens({ n: topic.n, title: upper(topic.title) })
	};
}
