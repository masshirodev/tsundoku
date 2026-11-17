import { appInstall, appModalPhase, appView, offered, parseAppUpdate } from './update';
import type { AppUpdate } from './update';

type UpdateBridge = {
	appUpdate?: () => string;
	appCheck?: () => void;
	appDownload?: () => void;
};

const bridge = (): UpdateBridge | null =>
	(window as unknown as { TsundokuTV?: UpdateBridge }).TsundokuTV ?? null;

/**
 * The app's update in this page (doc/UPDATES.md, "The Android apps"): a
 * module's state, so SETTINGS, the modal and the library's band read the same
 * one. A browser has no bridge, an older app has no `appUpdate`, and
 * in both `state` stays null and nothing is drawn.
 */
class AppUpdater {
	state = $state<AppUpdate | null>(null);
	/** UPDATE was pressed here, so the modal follows it, a failure included. */
	pressed = $state(false);
	/** HIDE: the download goes on, the modal is put away, the band counts. */
	hidden = $state(false);

	offer = $derived(this.state && offered(this.state, this.pressed) ? appView(this.state) : null);
	phase = $derived(this.state ? appModalPhase(this.state) : 'offer');
	install = $derived(this.state ? appInstall(this.state) : null);

	/** Read the state and hear every change; returns the undo. */
	connect(): () => void {
		const b = bridge();
		if (typeof b?.appUpdate !== 'function') return () => {};
		const w = window as unknown as { tsundokuAppUpdate?: (s: AppUpdate) => void };
		w.tsundokuAppUpdate = (s) => {
			// Android's own prompt was cancelled: back to an offer, with nothing to
			// follow. A download reaches `ready` too, on its way to installing.
			const was = this.state?.phase;
			if (s.phase === 'ready' && (was === 'installing' || was === 'permission'))
				this.pressed = false;
			this.state = s;
		};
		this.state = parseAppUpdate(b.appUpdate());
		return () => delete w.tsundokuAppUpdate;
	}

	check() {
		bridge()?.appCheck?.();
	}

	/** UPDATE, and TRY AGAIN: the app downloads what's offered, or installs what it has. */
	start() {
		this.pressed = true;
		this.hidden = false;
		bridge()?.appDownload?.();
	}

	/** LATER, after a failure. */
	reset() {
		this.pressed = false;
		this.hidden = false;
	}
}

export const appUpdater = new AppUpdater();
