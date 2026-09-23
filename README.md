# tsundoku

積ん読 — _buying books and letting them pile up unread_.

One library for everything read on a tablet: manga, manhwa, doujinshi, light
novels and web novels, served from the workstation over Tailscale and read in a
PWA. It replaces the five apps that currently split that job (Mihon, Hentoid,
Moon+ Reader, and whichever browser tab a web novel lives in this week), and it
is organised the owner's way rather than any one of theirs.

Status: **the library and series screens are built** from the "Index" design
system, on phone, tablet and desktop, against a sample library. There's no
scanner and no reader yet, so nothing real can be read. See "What it does not do
yet" in [`doc/LIBRARY.md`](doc/LIBRARY.md) and [`doc/SERIES.md`](doc/SERIES.md).

## Running it

```sh
yarn install
yarn run seed     # the design's sample library, into data/tsundoku.sqlite
yarn run dev      # localhost:42143, no token needed in development
yarn run import   # import $LIBRARY_ROOT/Mihon/ (doc/IMPORT-MIHON.md)
```

On the tablet it's served like kirisute: built, bound to the tailnet address
only, and behind a token.

```sh
echo "TSUNDOKU_TOKEN=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")" >> .env
yarn run build
yarn run serve    # http://<tailnet address>:42143
```

`serve` refuses to start without the token, and refuses a wildcard bind unless
`TSUNDOKU_BIND_ANY=1` says so by name. The workstation has no firewall, so
0.0.0.0 would serve the library to the whole LAN. `.env.example` lists every
variable.

Search doubles as the command line. Type these exactly and press Enter:
`/reveal` and `/hide` (show or hide hidden series), `/light` and `/dark`
(theme), `/incognito` (read without saving), `/scan` (rescan the device copies).

## Checks

```sh
yarn run check && yarn run lint && yarn run test
yarn run test:e2e    # when the UI changed; see doc/TESTING.md
```

## Why this exists instead of Mihon, Komga or Kavita

- **Organisation belongs to the owner.** Every app imported from brings its own
  categories. Here they arrive as plain tags that can be renamed or deleted, and
  the structure — collections, ratings, favourites — is ours.
- **Japanese raws are first-class.** Pages are OCR'd with mokuro on the
  workstation GPU, and tapping a speech bubble gives a lookup through yomu's
  tokenizer. Mined words go to Kumiko Flashcards. No off-the-shelf reader owns
  both the page and the SRS.
- **One reader for pictures and for text.** A manhwa and the web novel it was
  adapted from are the same series in different formats, not two apps.

## Where things live

| What            | Where                                                   |
| --------------- | ------------------------------------------------------- |
| This repository | `~/projects/tsundoku` (workstation)                     |
| Library files   | `/mnt/hdd2/tsundoku/library` (the mount with real room) |
| Import samples  | `/mnt/hdd2/tsundoku/samples` — **never commit these**   |
| Served on       | the tailnet address only, like kirisute                 |

The library is roughly 130 GB. It does not go under `/`, which is also home and
is the mount development pressures.

## Documents

- [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md) — shape of the system, data
  model, how it talks to Kumiko and yomu, and the phases.
- [`doc/IMPORT-FORMATS.md`](doc/IMPORT-FORMATS.md) — what Mihon, Hentoid and
  EPUB actually look like on disk, measured from real samples.
- [`doc/LIBRARY.md`](doc/LIBRARY.md) — the library screen: what drives each
  state, where it departs from the handoff, and what it doesn't do yet.
- [`doc/SERIES.md`](doc/SERIES.md) — the series screen: frame, states,
  departures, and what waits on the reader.
- [`doc/BOOKS.md`](doc/BOOKS.md) — series of books, grouping by hand, title
  suggestions, and person and tag pages.
- [`doc/IMPORT-MIHON.md`](doc/IMPORT-MIHON.md) — the Mihon importer: where it
  reads, what becomes what, the categories-as-ratings rule, and rescanning.
- [`doc/HISTORY.md`](doc/HISTORY.md) — the history screen: one row per series
  per day, removing a row, days and time zones.
- [`doc/PRIVACY.md`](doc/PRIVACY.md) — incognito, blanking on leave, and the
  deferred fingerprint gate.
- [`doc/READING-LOG.md`](doc/READING-LOG.md) — the append-only reading log that
  stats, history and tracking will be derived from, and why it exists first.
- [`doc/design/README.md`](doc/design/README.md) — the imported design system,
  where each part lives in the code, and its departures. `doc/design/handoff/` is
  the untouched mirror of the design project.
- [`doc/TESTING.md`](doc/TESTING.md) — the two test runners, the device
  projects, and regenerating the frame spec.
- [`doc/briefs/`](doc/briefs/) — design briefs for Claude Design. A brief moves
  to `doc/briefs/done/` once its handoff is back.

## Board labels

Tracked on the **Tsundoku** board in Kumiko. Beyond the defaults (`Feature`,
`Bug`, `Design`, `Infra`, `Docs`):

- **`Phase 1`**: needed before the tablet can be emptied. The filter answers
  "what is left before this replaces Mihon and Hentoid".
- **`Blocked`**: waiting on something outside the card (a design handoff, a
  sample from the tablet). Say what in the card body.
- **`Later`**: deliberately parked. Wanted, but not before the tablet is emptied
  (so never alongside `Phase 1`). The filter answers "what did we choose to
  postpone", which plain Backlog doesn't. When a card needs groundwork laid now
  so nothing is lost while it waits, the groundwork is its own card (for
  example the reading log under stats).
