/**
 * D-pad focus (doc/FOCUS.md): arrow keys move focus by geometry,
 * a sheet is a scope, and focus comes back to where it was. The remote's own
 * keys (doc/TV.md): OK held and MENU open the focused thing's options,
 * BACK closes, climbs, then leaves.
 *
 * The root layout installs it; Sheet.svelte marks its panel a scope; a screen
 * that reads its own arrows puts `data-focus-off` on its root, and one that has
 * something for BACK to close first registers a step.
 */
export {
	installFocusLayer,
	focusScope,
	saveFocus,
	restoreFocus,
	back,
	registerBack
} from './layer';
export type { BackStep } from './layer';
export { directionOf, nextIndex, nextInDirection, type Direction, type Rect } from './geometry';
export { HOLD_MS, isBackKey, isOkKey, isOptionsKey, OkPress } from './keys';
