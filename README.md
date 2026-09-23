# tsundoku

積ん読 — _buying books and letting them pile up unread_.

One library for everything read on a tablet: manga, manhwa, doujinshi, light
novels and web novels, served from the workstation over Tailscale and read in a
PWA. It replaces the five apps that currently split that job (Mihon, Hentoid,
Moon+ Reader, and whichever browser tab a web novel lives in this week), and it
is organised the owner's way rather than any one of theirs.

Status: **pre-code.** The architecture and the import formats are written down;
the screens are waiting on a design handoff. See [`doc/`](doc/).

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

| What                  | Where                                                    |
| --------------------- | -------------------------------------------------------- |
| This repository       | `~/projects/tsundoku` (workstation)                      |
| Library files         | `/mnt/hdd2/tsundoku/library` (the mount with real room)  |
| Import samples        | `/mnt/hdd2/tsundoku/samples` — **never commit these**    |
| Served on             | the tailnet address only, like kirisute                  |

The library is roughly 130 GB. It does not go under `/`, which is also home and
is the mount development pressures.

## Documents

- [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md) — shape of the system, data
  model, how it talks to Kumiko and yomu, and the phases.
- [`doc/IMPORT-FORMATS.md`](doc/IMPORT-FORMATS.md) — what Mihon, Hentoid and
  EPUB actually look like on disk, measured from real samples.
- [`doc/briefs/`](doc/briefs/) — design briefs for Claude Design, one per
  surface.

## Board labels

Tracked on the **Tsundoku** board in Kumiko. Beyond the defaults (`Feature`,
`Bug`, `Design`, `Infra`, `Docs`):

- **`Phase 1`**: needed before the tablet can be emptied. The filter answers
  "what is left before this replaces Mihon and Hentoid".
- **`Blocked`**: waiting on something outside the card (a design handoff, a
  sample from the tablet). Say what in the card body.
