# Settings

`/settings`, reached from the sidebar's SETTINGS (the desktop). These are the
library's own preferences. They apply on every device, unlike the reader's
READING sheet, which each browser keeps for itself.

They are stored in the `settings` table (rung 24) and read through
`getSetting` / `setSetting` in `src/lib/server/settings.ts`, each with a
default in code, so a missing row means the default.

## 01 — Books in several languages

**OPENS IN**: ENGLISH (the default, the owner's choice on 2026-09-24),
JAPANESE, CHINESE or KOREAN. This is the language a folded book opens in
([`EDITIONS.md`](EDITIONS.md)). A book without an edition in that language
opens in the one last read. A book's own LANGUAGE row overrides this, and the
screen counts how many books do. Changing it refreshes the folded books'
covers, since a tile wears its opening edition's cover.

The counts (N FOLDED, N BOOKS DO) follow reveal: hidden books aren't counted
while hidden.

## 02 — Catalogues

The AniList and MAL sign-ins, one row each ([`TRACKING.md`](TRACKING.md)):
who's signed in, whether the list was read, and what didn't send. The row
offers SIGN IN →, SIGN OUT or TRY AGAIN. The header counts the links and
the series waiting in the link review ([`LINKS.md`](LINKS.md)). Coming back
from a sign-in, a band says how it went (`?signin=ok|failed|refused|unconfigured`).
