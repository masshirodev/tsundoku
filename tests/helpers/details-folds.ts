/**
 * The `@media` query SeriesPanel.svelte uses to fold DETAILS' rows
 * (`src/routes/series/[id]/SeriesPanel.svelte:2442`): a phone's width, or a
 * TV. Above it the panel draws FILE and the other rows inline; at it they sit
 * behind DETAILS' line.
 *
 * One copy, so a spec that has to know whether DETAILS is folded reads the
 * app's rule and not a stale transcription of it (c601; the two copies this
 * replaced were `series-layout.e2e.ts`'s and `series-rename-flow.e2e.ts`'s).
 * Read it with `matchMedia` before the panel draws, never with a one-shot
 * `isVisible()`: a line that has not drawn yet reads as "no fold" on a loaded
 * phone or TV.
 */
export const DETAILS_FOLDS = '(max-width: 599px), (pointer: none) and (min-width: 900px)';
