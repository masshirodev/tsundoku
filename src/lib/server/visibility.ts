/**
 * The one rule for what is hidden (doc/LIBRARY.md, "Hidden means hidden"),
 * as SQL over `series s JOIN roots r`. Every read that honours reveal uses
 * these, and nothing else spells the rule out.
 *
 * A series is hidden when it is hidden itself, or when its root is hidden and
 * it hasn't been made public. UNHIDE on a series in a hidden root (all of
 * Hentoid, Mihon's local folder) sets `public`, so one book can come out
 * without the rest of the root following it.
 */
export const HIDDEN_SQL = `(s.hidden = 1 OR (r.hidden = 1 AND s.public = 0))`;
export const VISIBLE_SQL = `(s.hidden = 0 AND (r.hidden = 0 OR s.public = 1))`;

export const visibleWhere = (reveal: boolean) => (reveal ? '1' : VISIBLE_SQL);
