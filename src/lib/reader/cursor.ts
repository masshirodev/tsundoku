import { readLocal, writeLocal } from '$lib/settings/local';
import { valueDef } from '$lib/settings/catalog';
import { CURSOR_KEY } from './reader';

/**
 * The player's CURSOR (c713; doc/SETTINGS.md, "03"), a key of its own. The
 * readers keep `tsundoku.reader.cursor`, off by default, and the player is on by
 * default: one key with two defaults made SETTINGS say OFF while the player hid
 * the cursor.
 *
 * Until c713 the player read the readers' key, so a device can hold an answer
 * there that the player must keep honouring: the only way to turn the player's
 * off was to switch the readers' on and off. It is carried over once per device.
 * Once and not on every read, because a RESET removes the player's value (the
 * SETTINGS page stores no default): a read that fell back to the readers' key
 * would bring the old OFF back, and tie the player to the readers again.
 */
export const PLAYER_CURSOR_KEY = valueDef('anime.cursor').key;
/** Not a setting, so not mirrored: each device has its own past to carry. */
const CARRIED_KEY = 'tsundoku:anime:cursor.carried';

/** Whether the player hides the cursor with its controls, on this device. */
export function playerCursorOn(): boolean {
	if (!readLocal<boolean>(CARRIED_KEY, false)) {
		const own = readLocal<boolean | null>(PLAYER_CURSOR_KEY, null);
		const shared = readLocal<boolean | null>(CURSOR_KEY, null);
		// A value already here came from SETTINGS, or from the workstation: newer.
		if (own === null && shared !== null) writeLocal(PLAYER_CURSOR_KEY, shared);
		writeLocal(CARRIED_KEY, true);
	}
	return readLocal<boolean>(PLAYER_CURSOR_KEY, true);
}
