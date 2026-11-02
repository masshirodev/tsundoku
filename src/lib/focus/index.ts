/**
 * D-pad focus (card c234, doc/FOCUS.md): arrow keys move focus by geometry,
 * a sheet is a scope, and focus comes back to where it was.
 *
 * The root layout installs it; Sheet.svelte marks its panel a scope; a screen
 * that reads its own arrows puts `data-focus-off` on its root.
 */
export { installFocusLayer, focusScope, saveFocus, restoreFocus } from './layer';
export { directionOf, nextIndex, nextInDirection, type Direction, type Rect } from './geometry';
