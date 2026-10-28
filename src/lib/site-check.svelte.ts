import { resolve } from '$app/paths';

/**
 * While a page waits on a source, asks once a second whether the engine is
 * passing that site's browser check (`/api/browse/check`; doc/BROWSE.md, "A
 * site's check"; card c143), and keeps a clock of how long it has asked. The
 * page names the check at once (Browse Calls, "A site's check is named at
 * once") instead of waiting ten seconds to say it's slow.
 */
export class SiteCheck {
	/** When the engine started passing the check; null while it isn't. */
	since = $state<number | null>(null);
	/** How long this wait has lasted, in ms, ticking each second. */
	elapsed = $state(0);
	#timer: ReturnType<typeof setInterval> | null = null;
	#started = 0;

	start(sourceId: string): void {
		this.stop();
		this.#started = Date.now();
		this.elapsed = 0;
		const url = resolve('/api/browse/check/[source]', { source: sourceId });
		const tick = async () => {
			this.elapsed = Date.now() - this.#started;
			try {
				const res = await fetch(url, { cache: 'no-store' });
				if (res.ok) this.since = ((await res.json()) as { since: number | null }).since;
			} catch {
				// Not answering is its own state, drawn when the answer comes back as one.
			}
		};
		void tick();
		this.#timer = setInterval(() => void tick(), 1_000);
	}

	stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		this.since = null;
	}
}

/** The band's second line: "ASKED 18 S AGO · A FIRST VISIT TAKES 20–45 S · QUICK AFTER THAT". */
export const checkLine = (elapsed: number) =>
	`ASKED ${Math.floor(elapsed / 1000)} S AGO · A FIRST VISIT TAKES 20–45 S · QUICK AFTER THAT`;
