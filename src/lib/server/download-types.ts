import type { DownloadState, QueueItem, ResultMatch } from '../library/downloads.ts';

/**
 * What the download screens are handed (doc/DOWNLOADING.md): the shapes the
 * engine's backend answers in (engine/backend.ts, through server/downloads.ts).
 * They began as Suwayomi's and outlived it (card c129).
 */

/** The download queue, in the order it downloads. */
export type Queue = { running: boolean; items: QueueItem[] };

/** What the series row and its chapters need. */
export type SeriesDownloads =
	/** Nothing to say: not a Mihon series, or downloading isn't set up here. */
	| { kind: 'none' }
	/** A Mihon source no installed extension has (Bato.to, Hitomi): the tablet downloads it. */
	| { kind: 'elsewhere'; source: string }
	| { kind: 'down'; since: number }
	| {
			kind: 'ok';
			states: Record<number, DownloadState>;
			/** Chapters queued for other series, for ALL's confirmation. */
			queuedElsewhere: number;
			/**
			 * FOLLOW: whether it's on, and when the source was last asked for new
			 * chapters. Null where it isn't offered: a novel, until c151.
			 */
			follow: { on: boolean; checked: number | null } | null;
	  };

export type QueueSummary = {
	queued: number;
	failed: number;
	/** The series that failed, by title, for the library's band. */
	failedSeries: string[];
	/** The engine isn't answering: these are the last numbers it gave. */
	stale: boolean;
};

export type SearchHit = {
	/** Opaque: the source's id and the manga's URL (engine/backend.ts). */
	mangaId: string;
	title: string;
	parts: { pre: string; mid: string; post: string };
	cover: string;
	meta: string;
	match: ResultMatch;
};

export type SourceManga = {
	id: string;
	title: string;
	description: string;
	author: string;
	artist: string;
	genres: string[];
	status: string;
	source: string;
	sourceId: string;
	url: string;
	inLibrary: boolean;
	thumbnailUrl: string;
	/** The preview's cover, as one of tsundoku's own URLs. */
	cover: string;
	/** The series' page at the source, for OPEN ↗; '' when the source doesn't say. */
	realUrl: string;
	/** The source's language, from its name: "EN". */
	lang: string;
	chapters: {
		id: string;
		url: string;
		name: string;
		number: number;
		scanlator: string;
		sourceOrder: number;
		uploadDate: number;
		fetchedAt: number;
	}[];
};
