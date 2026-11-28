import { clipRange, type ClipMark, type ClipRange } from '$lib/library/highlights';
import type { ClipJob } from '$lib/server/highlights/clips';

/**
 * The player's side of a clip (Anime.dc.html 01, 02): the marks, the
 * job's band, and the kept ranges on the scrubber. The range arithmetic is
 * `clipRange`; what the workstation is doing is its answer, polled while a job
 * is on the way. Leaving the page does not stop one (A6).
 */

export type { ClipJob };
const POLL_MS = 1000;

export type ClipFailure = NonNullable<ClipJob['why']>;

export const CLIP_WHY: Record<ClipFailure | 'unreachable', string> = {
	stream: 'THE STREAM STOPPED ANSWERING',
	down: "THE WORKSTATION ISN'T ANSWERING",
	unreachable: "THE WORKSTATION ISN'T ANSWERING",
	disk: 'NO ROOM ON THE DISK',
	file: "THE FILE COULDN'T BE READ",
	gone: 'THE EPISODE IS GONE'
};

/** A KEEP the workstation answered and refused: no TRY AGAIN, the same ask gets the same no. */
export const CLIP_REFUSED: Record<number, string> = {
	400: "THAT RANGE CAN'T BE KEPT",
	403: 'INCOGNITO KEEPS NO CLIPS',
	404: CLIP_WHY.gone
};

const api = '/api/highlights/clips';

export class ClipMarks {
	mark = $state<ClipMark | null>(null);
	jobs = $state<ClipJob[]>([]);
	kept = $state<{ from: number; to: number; id: number }[]>([]);
	/** A KEEP the workstation never answered: the range is still marked, so TRY AGAIN needs nothing. */
	unreachable = $state(false);
	/** A KEEP it answered with a 400, 403 or 404: why, in the player's words. */
	refused = $state<string | null>(null);
	/** Jobs the player let go of: a poll still in flight mustn't bring one back. */
	#dismissed: string[] = [];
	#entry: number;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#alive = true;

	constructor(entry: number, kept: { from: number; to: number; id: number }[]) {
		this.#entry = entry;
		this.kept = kept;
	}

	range(playhead: number): ClipRange | null {
		return this.mark ? clipRange(this.mark, playhead) : null;
	}

	markIn(at: number) {
		this.#clearAsk();
		// MARK IN again moves the start, keeping an out point still within 3:00 (A3).
		if (!this.mark) {
			this.mark = { in: at, out: null };
			return;
		}
		const out = this.mark.out;
		this.mark = { in: at, out: out !== null && Math.abs(out - at) <= 180 ? out : null };
	}

	markOut(at: number) {
		if (this.mark) this.mark = { ...this.mark, out: at };
	}

	drop() {
		this.mark = null;
		this.#clearAsk();
	}

	#clearAsk() {
		this.unreachable = false;
		this.refused = null;
	}

	async keep(
		playhead: number,
		tracks: { subtitle: string | null; audio: string | null; height: number | null },
		fresh = false
	) {
		const r = this.range(playhead);
		if (!r || r.length <= 0) return;
		await this.#post({ entry: this.#entry, from: r.from, to: r.to, ...tracks, fresh });
	}

	/** TRY AGAIN: asks the stream afresh (?fresh=1 in the player's words, A8). */
	async retry(
		job: ClipJob,
		tracks: { subtitle: string | null; audio: string | null; height: number | null }
	) {
		this.dismiss(job.id);
		await this.#post({ entry: this.#entry, from: job.from, to: job.to, ...tracks, fresh: true });
	}

	async #post(body: Record<string, unknown>) {
		this.#clearAsk();
		try {
			const r = await fetch(api, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const refusal = CLIP_REFUSED[r.status];
			if (refusal) {
				this.refused = refusal;
				return;
			}
			if (!r.ok) throw new Error(String(r.status));
			const job = (await r.json()) as ClipJob;
			this.#merge([job]);
			if (job.step === 'failed') this.#reMark(job);
			else this.mark = null;
			if (job.step === 'made') this.#learnKept(job);
			this.#poll();
		} catch {
			// No answer at all: the range stands and the band says so.
			this.unreachable = true;
		}
	}

	dismiss(id: string) {
		this.#dismissed.push(id);
		this.jobs = this.jobs.filter((j) => j.id !== id);
	}

	/** ✕ on the band: stops the job and drops the range (A6). */
	async stop(job: ClipJob) {
		this.dismiss(job.id);
		this.mark = null;
		await fetch(`${api}/${job.id}`, { method: 'DELETE' }).catch(() => {});
	}

	#reMark(job: ClipJob) {
		if (!this.mark) this.mark = { in: job.from, out: job.to };
	}

	#learnKept(job: ClipJob) {
		if (job.highlightId !== null && !this.kept.some((k) => k.id === job.highlightId))
			this.kept = [...this.kept, { from: job.from, to: job.to, id: job.highlightId }];
	}

	#merge(incoming: ClipJob[]) {
		const next = [...this.jobs];
		for (const j of incoming) {
			if (this.#dismissed.includes(j.id)) continue;
			const i = next.findIndex((x) => x.id === j.id);
			if (i < 0) {
				// A clip made before this page opened is a box, not news: its band
				// said its piece to whoever pressed KEEP.
				if (j.step === 'made') this.#learnKept(j);
				else next.push(j);
				continue;
			}
			if (next[i].step !== j.step) {
				if (j.step === 'made') this.#learnKept(j);
				if (j.step === 'failed') this.#reMark(j);
			}
			next[i] = j;
		}
		this.jobs = next;
	}

	/** What the workstation has for this episode now, and again while something is on the way. */
	async refresh() {
		try {
			const r = await fetch(`${api}?entry=${this.#entry}`);
			if (r.ok) {
				const got = (await r.json()) as ClipJob[];
				this.#merge(got);
				for (const j of got) if (j.step === 'made') this.#learnKept(j);
			}
		} catch {
			// The next tick; a workstation away is said by a KEEP that gets no answer, and
			// a poll that gets one says nothing about that KEEP: its band stays till the next.
		}
	}

	#poll() {
		clearTimeout(this.#timer);
		if (!this.#alive) return;
		this.#timer = setTimeout(async () => {
			await this.refresh();
			if (
				this.jobs.some((j) => j.step === 'waiting' || j.step === 'fetching' || j.step === 'cutting')
			)
				this.#poll();
		}, POLL_MS);
	}

	start() {
		void this.refresh().then(() => {
			if (this.jobs.some((j) => j.step !== 'made' && j.step !== 'failed')) this.#poll();
		});
	}

	stopPolling() {
		this.#alive = false;
		clearTimeout(this.#timer);
	}
}
