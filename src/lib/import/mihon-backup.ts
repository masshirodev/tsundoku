import { Message } from './protobuf.ts';

/**
 * Mihon's `.tachibk` (gunzipped), decoded into the parts tsundoku imports.
 * Field numbers are Mihon's published `Backup` schema, checked against a
 * real backup on 2026-09-23 (doc/IMPORT-MIHON.md has the table). Everything
 * else in the file -- preferences, extension repos, trackers -- is skipped.
 */

export type MihonChapter = {
	url: string;
	name: string;
	scanlator: string;
	read: boolean;
	bookmark: boolean;
	/** 0-based. Mihon keeps it after a chapter is read, too. */
	lastPageRead: number;
	dateFetch: number;
	dateUpload: number;
	/** -1 when the source gave no number. */
	number: number;
	/** 0 is the newest chapter in the source's own list. */
	sourceOrder: number;
};

export type MihonHistory = { url: string; lastRead: number; readDuration: number };

export type MihonManga = {
	/** A 64-bit id, kept as a decimal string. */
	source: string;
	url: string;
	title: string;
	artist: string;
	author: string;
	description: string;
	genres: string[];
	/** 0 unknown, 1 ongoing, 2 completed, 3 licensed, 4 publishing finished, 5 cancelled, 6 on hiatus. */
	status: number;
	thumbnailUrl: string;
	dateAdded: number | null;
	/** Reading mode, the low three bits of viewer_flags. */
	viewer: number;
	chapters: MihonChapter[];
	/** Category `order` values, which is how a manga refers to its categories. */
	categories: number[];
	/** In the library. False for a series only ever browsed. */
	favorite: boolean;
	history: MihonHistory[];
};

export type MihonCategory = { name: string; order: number };

export type MihonBackup = {
	manga: MihonManga[];
	categories: MihonCategory[];
	/** Source id -> name ("Asura Scans"). */
	sources: Map<string, string>;
};

function chapter(m: Message): MihonChapter {
	return {
		url: m.str(1),
		name: m.str(2),
		scanlator: m.str(3),
		read: m.bool(4),
		bookmark: m.bool(5),
		lastPageRead: m.num(6),
		dateFetch: m.num(7),
		dateUpload: m.num(8),
		number: m.has(9) ? m.float(9) : -1,
		sourceOrder: m.num(10)
	};
}

function manga(m: Message): MihonManga {
	return {
		source: m.big(1).toString(),
		url: m.str(2),
		title: m.str(3),
		artist: m.str(4),
		author: m.str(5),
		description: m.str(6),
		genres: m.strs(7),
		status: m.num(8),
		thumbnailUrl: m.str(9),
		dateAdded: m.has(13) ? m.num(13) : null,
		// viewer_flags (103) replaced viewer (14); older backups have only 14.
		viewer: (m.has(103) ? m.num(103) : m.num(14)) & 0x7,
		chapters: m.messages(16).map(chapter),
		categories: m.nums(17),
		// proto2 default true: absent means in the library.
		favorite: m.bool(100, true),
		history: m.messages(104).map((h) => ({
			url: h.str(1),
			lastRead: h.num(2),
			readDuration: h.num(3)
		}))
	};
}

export function decodeBackup(raw: Uint8Array): MihonBackup {
	const root = new Message(raw);
	return {
		manga: root.messages(1).map(manga),
		categories: root.messages(2).map((c) => ({ name: c.str(1), order: c.num(2) })),
		sources: new Map(root.messages(101).map((s) => [s.big(2).toString(), s.str(1)]))
	};
}
