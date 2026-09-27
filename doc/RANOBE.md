# Ranobe

tsundoku keeps the owner's **Ranobe** library (`ranobe.ink`, the owner's own
catalogue, `~/projects/ranobe`) moving from what's read here: which novels are
in it, how far each is read, its rating and its favourite. It's card c66
("Track novels through Ranobe, once it's ready"). The contract it's built
against is Ranobe's `doc/API-V1.md`, "For Tsundoku", and the steps below use
its numbers.

- Code:
  - `src/lib/library/ranobe.ts`: the pure rules (volumes, units, editions).
  - `src/lib/server/ranobe.ts`: the client, the pass, the sends.
  - `scripts/ranobe.ts`: `yarn run ranobe`, the pass by hand.
- Rung 31: `ranobe_links`, `entries.ranobe_unit`, `ranobe_units`,
  `ranobe_works`, `ranobe_suggestions`.
- Specs: `tests/ranobe-domain.spec.ts`, `tests/ranobe-db.spec.ts`.

**Part 1 has no screen.** The brief for part 2 is [`briefs/RANOBE.md`](briefs/RANOBE.md): choosing a work on `/links` for a novel the ids
don't find, a Ranobe line on the TRACKING row and a Ranobe cell on SETTINGS
all wait for a design handoff. Until then the pass and the sends run on their
own, and `yarn run ranobe` prints what they did.

## What the owner decided

- **Novels only, for now** (2026-09-25). Comics stay on AniList, the main list
  for them. `RANOBE_KINDS` is the one line to change when that widens: nothing
  else assumes novels.
- **A missing edition is suggested** (2026-09-27). Ranobe mostly has a work's
  Japanese original, and the EPUBs here are English. A series waits for an
  edition in its own language, and when there's none, the pass suggests one
  to Ranobe for the owner to review there. Nothing of that work is sent until
  it's approved. Mapping English volumes onto the Japanese edition was the
  alternative: it would sync at once, and it would say the Japanese volumes
  were read.

## The token

`RANOBE_TOKEN` in `.env`, from Infisical ([`SECRETS.md`](SECRETS.md)). It's a
personal token made in Ranobe's _Settings › Connected apps_ with **Read
catalogue**, **Write library** and **Suggest entries** (`catalogue:read`,
`library:write`, `catalogue:write`). With no token, nothing here runs and
nothing is asked. `RANOBE_URL` points it elsewhere (`http://localhost:42145/api/v1`
for Ranobe's dev server). The e2e server's `TSUNDOKU_ANILIST=off`, or
`TSUNDOKU_RANOBE=off`, keeps it off the network.

Checked on 2026-09-27: the token authenticates, and the library was empty.

## Privacy

What tsundoku never sends anywhere else, it never sends Ranobe, and that
covers **asking** as well as telling (step 0 of the contract). A hidden
series and anything from Hentoid is never looked up, never suggested and never
sent. `ELIGIBLE_SQL` in `src/lib/server/ranobe.ts` is the one place the rule is
spelled, and every query uses it. Reading in incognito records no `read_at`,
so there is nothing for a send to follow.

**Hiding a series takes nothing back.** Its reads already on Ranobe stay
there, and nothing more is sent for it. Only what a series Ranobe may hear of
maps onto is ever sent or unsent.

## The pass

After every import (after the links and the AniList and MAL lists), and from
`yarn run ranobe`. It logs counts, never titles.

1. **Matching** (step 2). Every novel with an AniList or MAL id is asked
   about with `POST /lookup`, and a work that answers is linked `via
'lookup'`. A cover-only link (a novel to its comic's entry, [`LINKS.md`](LINKS.md))
   is the comic's id, so it's never asked. Several series may share a work:
   The Eminence in Shadow is a series per EPUB volume (step 3).
2. **Editions.** `GET /works/{ref}` for each work still waiting. The edition
   in the series' language is taken (`entries.language`, English when none
   is recorded): licensed before original before fan, an ebook before print.
   With none, a suggestion (below).
3. **Units** (step 4). `GET /editions/{ref}?fields=units` once per edition,
   and each entry keeps its unit ref in `entries.ranobe_unit`. Mapped again
   every pass, since an import may add chapters.
4. **Sending** what's read (steps 7 and 8), marked `backfill` in the pass.

### Which unit an entry is

The edition's table of contents says. Three shapes:

| The series is                     | Recognised by                                         | Each entry maps onto                 |
| --------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| One EPUB volume                   | "Vol. 2", "Volume 5", "Book 10", or "… 08" at the end | That volume, for every body entry    |
| A volume per entry                | Entry labels "Vol. 3"                                 | Its volume                           |
| A chapter per entry (a web novel) | Entry labels leading with a number, "254 Hello…"      | Its chapter, if the edition has them |

A span such as "1-1429" or "c1-591" is no volume. Front and back matter maps
onto nothing, and so does anything the edition doesn't list.

**A unit is read once every entry mapped onto it is**, at the last of those
reads. Half a volume read sends nothing. Two copies of one volume (The
Beginning After The End 08 is two series today) count once: read in either is
read.

## Editions, suggested

A work with no edition in the series' language gets one suggested, once per
work and language, as a one-item bundle (`POST /bundles`):

- `lang` the series', `origin: licensed`, `format: ebook`: the likeliest for
  an English EPUB, and the owner reviews it either way.
- Its units are volumes 1 to the highest this library holds of the work,
  since an English volume 5 means there were four before it.
- The `reason` names the volumes held, never a title or a file.

`ranobe_suggestions` keeps the bundle. Each pass asks `GET /bundles/{id}`
until it's decided. Approved, its edition becomes the series' and the pass
maps and sends at once. Rejected or withdrawn, it's never suggested again
(the owner said no). A suggestion that couldn't be sent is tried again.

**The owner's token applies them at once.** It is their own account, a
moderator's, so Ranobe approves the bundle as it's sent, with the owner as
reviewer. That happened in the first pass, 2026-09-27. An app's own account
(Ranobe's `ACCOUNTS.md`, "An app's account") would have every suggestion wait
for review instead, and the pass handles that too. If the owner wants to
review what tsundoku suggests before it's live, the token has to move to such
an account.

## Sending

`ranobe_units` is each unit **as read here** (`read_at`) against **what was
sent** (`sent_at`). A send is the difference:

- **Read here, not sent:** `POST /me/reads`, 500 a request, at `read_at`.
  Ranobe takes a batch all or nothing. A read it refuses by its unit
  (`invalid_field`, `reads.N.unit`) is kept with **RANOBE REFUSED IT**, and
  the rest go without it.
- **Sent, and read here no longer** (MARK UNREAD): `DELETE /me/reads/{unit}`.
  A read made on the site, or by anything else, is never taken back: only
  what tsundoku sent.
- **Rating and favourite** (step 9): `ranobe_works` holds what waits, and it
  goes with `PUT /me/library/{work}` and the `rev` a `GET` just read, once
  more on `409 stale_rev` with `details.currentRev`. The rating is Ranobe's
  1–10 as it is ([`RATINGS.md`](RATINGS.md)), and unrated is `null`. Several
  series of one work share its rating, so the last one set is the work's.

**When:** a chapter finished in the reader, MARK READ and MARK UNREAD, a
mark-read-through, a rating or FAV set, and the pass. Always off the request,
and one flush at a time. A send that fails keeps **RANOBE DID NOT ANSWER**,
**RANOBE REFUSED THE TOKEN** or **RANOBE REFUSED IT**, and goes with the next
flush.

**Status isn't sent.** Ranobe works it out from the reads: the first read
adds a work as READING, and the last unit of the edition makes it COMPLETED.
A work rated before anything is read is added as PLANNING.

## Where things stood on 2026-09-27

Of the 23 novels, the ids found 5 works on Ranobe (Alya, The Eminence in
Shadow, Kino's Journey, Mushoku Tensei, The Apothecary Diaries), each with
only its Japanese original edition. Apothecary's edition has no units yet.
None of the Korean web novels is on Ranobe (The Beginning After the End, Lord
of the Mysteries, Omniscient Reader's Viewpoint, and the rest), and only 3
novel entries were read, all in one Ranobe doesn't have.

The first pass (`yarn run ranobe`, right after the deploy) linked 8 series to
those 5 works. It suggested an English edition for each, which Ranobe applied
at once (bundles 1–5, editions e1180–e1184), and mapped 109 entries onto their
volumes. It sent no reads, since none of them is read yet.

## Not yet

- **Choosing on `/links`** (step 2's other half): `GET /search?kind=light_novel,web_novel`
  for a novel the ids don't find, with `matched`, `years` and `units` to tell
  candidates apart. Needs the design brief.
- **Screens**: a Ranobe line on the TRACKING row, a cell on SETTINGS with what
  failed and TRY AGAIN, and the suggestions waiting on review.
- **Suggesting works and people** (step 12): the EPUB importer reading
  `dc:title`, `dc:creator`, `dc:publisher`, `dc:language` and the ISBN, and
  suggesting a novel Ranobe lacks. That is how the Korean web novels get
  there.
- **Rereads** (step 10): a new read-through. Today a read sent again lands in
  the current one as a duplicate.
- **The other direction** (step 11): `GET /me/reads?since=` and
  `/me/library?since=`, for what changed on the site.
- **Freshness** (step 5): `GET /changes?since=` for titles and covers.
