import { installAndWait, type UpdateView } from './updates.ts';

/**
 * One UPDATE in this tab (doc/UPDATES.md, "Told on entry"): what the modal
 * shows while it runs, and what the library's band counts once HIDE put the
 * modal away. A module's state, so the band and the modal read the same run;
 * only ever started in the browser.
 */
class UpdateRun {
	/** The last view the old server gave while it ran. */
	view = $state<UpdateView | null>(null);
	/** Since when nobody has answered: the installer stopped the server. */
	awaySince = $state<number | null>(null);
	/** Why UPDATE stopped, when it did. */
	failed = $state<string | null>(null);
	running = $state(false);
	/** HIDE: the run goes on, the modal is put away, the band counts. */
	hidden = $state(false);
	target = $state<string | null>(null);

	async start(target: string) {
		this.target = target;
		this.running = true;
		this.hidden = false;
		this.failed = null;
		this.awaySince = null;
		await installAndWait({
			target,
			onView: (v) => {
				this.view = v;
				this.awaySince = null;
				if (v.install?.phase === 'failed') {
					this.failed = v.install.error;
					this.running = false;
					this.hidden = false;
				}
			},
			onAway: () => (this.awaySince ??= Date.now()),
			onRefused: (why) => {
				this.failed = why;
				this.running = false;
			}
		});
	}

	/** LATER, after a failure: back to nothing running. */
	reset() {
		this.failed = null;
		this.running = false;
		this.hidden = false;
		this.view = null;
		this.awaySince = null;
	}
}

export const updateRun = new UpdateRun();
