import { getDb } from '$lib/server/db';
import { otherFormsOf, type OtherForm } from '$lib/server/relations';
import { workFeetFor } from '$lib/server/works';

/** A series as GROUP's sheet lists it. */
export type GroupBook = {
	seriesId: number;
	title: string;
	hue: number;
	addedAt: number;
	cover: number | null;
};

/**
 * What an IN LIBRARY row offers about a Work (c700; doc/SERIES.md, "OTHER
 * FORMS"): `same`, already one Work, at that part; `group`, neither in one, so
 * GROUP AS A WORK. Null when one of them is in a Work and the two are not
 * together: the flow's add, on this screen, takes only MIGHT CONTINUE's offer
 * (`?/addToWork`), so there is nothing to offer.
 */
export type FormWork = { state: 'same'; workId: number; part: number } | { state: 'group' } | null;

export type OtherFormRow = OtherForm & { book: GroupBook | null; work: FormWork };

export type OtherForms = { self: GroupBook; rows: OtherFormRow[] };

/** Called by a row's GROUP AS A WORK with the other series. */
export type GroupOther = (other: GroupBook) => void;

const bookOf = (id: number): GroupBook | null =>
	(getDb()
		.prepare(
			`SELECT id AS seriesId, title, hue, added_at AS addedAt, cover_at AS cover FROM series WHERE id = ?`
		)
		.get(id) as GroupBook | undefined) ?? null;

/** The series screen's OTHER FORMS: the cached forms, and each one's place beside this series. */
export function otherFormsView(seriesId: number, reveal: boolean): OtherForms | null {
	const forms = otherFormsOf(seriesId, reveal);
	const self = forms && bookOf(seriesId);
	if (!forms || !self) return null;
	const held = forms.flatMap((f) => (f.seriesId === null ? [] : [f.seriesId]));
	const feet = workFeetFor([seriesId, ...held]);
	const mine = feet.get(seriesId);
	return {
		self,
		rows: forms.map((f) => {
			if (f.seriesId === null) return { ...f, book: null, work: null };
			const theirs = feet.get(f.seriesId);
			const work: FormWork =
				mine && theirs && mine.id === theirs.id
					? { state: 'same', workId: theirs.id, part: theirs.part }
					: !mine && !theirs
						? { state: 'group' }
						: null;
			return { ...f, book: bookOf(f.seriesId), work };
		})
	};
}
