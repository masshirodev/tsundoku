# Ranobe

tsundoku keeps the owner's **Ranobe** library (`ranobe.ink`, the owner's own
catalogue, `~/projects/ranobe`) moving from what's read here: which novels and
comics are in it, how far each is read, its rating and its favourite. It's
card c66 ("Track novels through Ranobe, once it's ready"), and for comics card
c98 ("Send comic reads to Ranobe, once Ranobe has work-level chapters"); see
"Comics" below. The contract it's built
against is Ranobe's `doc/API-V1.md`, "For Tsundoku", and the steps below use
its numbers.

- Brief: [`briefs/done/RANOBE.md`](briefs/done/RANOBE.md). Handoff:
  `doc/design/handoff/Ranobe.dc.html`, with `Ranobe Review.dc.html` and
  `Ranobe Series.dc.html` (the zip is `doc/handoffs/done/Ranobe.zip`).
- Code:
  - `src/lib/library/ranobe.ts`: the pure rules (volumes, units, editions,
    the review's lines, the TRACKING line).
  - `src/lib/server/ranobe.ts`: the client, the pass, the sends, searching.
  - `src/lib/server/ranobe-review.ts`: the review's queue and decisions, and
    what the series screen and SETTINGS read.
  - `src/routes/api/links/ranobe/`: the review's decisions.
  - `src/routes/links/`: the review, AniList's and Ranobe's.
  - The series screen's `?/unlinkRanobe` and `?/retryRanobe`; SETTINGS'
    `?/retryRanobe`.
  - `scripts/ranobe.ts`: `yarn run ranobe`, the pass by hand.
- Rung 31: `ranobe_links`, `entries.ranobe_unit`, `ranobe_units`,
  `ranobe_works`, `ranobe_suggestions`. Rung 32: `ranobe_searches`,
  `ranobe_candidates`, `ranobe_decisions`, and Ranobe's own word on each
  work in `ranobe_works`. Rung 38: `ranobe_work_units`, what each comic's
  work counts.
- Specs: `tests/ranobe-domain.spec.ts`, `tests/ranobe-db.spec.ts`,
  `tests/ranobe-review-db.spec.ts`, `tests/ranobe-flow.e2e.ts`.

Built in two parts on 2026-09-27: the link, the pass and the sends with no
screen (part 1), then the review, the series screen and SETTINGS from the
handoff (part 2).

## What the owner decided

- **Novels only, for now** (2026-09-25), **and comics too** since 2026-10-14
  (card c98). Comics stayed on AniList until Ranobe's works could count their
  own chapters (Ranobe's card c226); now manga and manhwa go to both, AniList
  as before and Ranobe beside it. Doujinshi never: they're Hentoid's.
- **A missing edition is suggested** (2026-09-27). Ranobe mostly has a work's
  Japanese original, and the EPUBs here are English. A series waits for an
  edition in its own language, and when there's none, the pass suggests one
  to Ranobe for the owner to review there. Nothing of that work is sent until
  it's approved. Mapping English volumes onto the Japanese edition was the
  alternative: it would sync at once, and it would say the Japanese volumes
  were read.
- **Suggestions go through an app account and wait** (2026-09-27, card c72).
  The owner's token is a moderator's, so anything it suggests is applied at
  once, and the EPUBs' metadata is too rough for that. Tsundoku suggests
  through Ranobe's `tsundoku` app account instead, whose edits always wait for
  the owner, who corrects them in Ranobe's own editor before approving. That's
  Ranobe's own plan (its `ACCOUNTS.md`, "An app's account"). The owner's token
  stays for the library.

## The token

`RANOBE_TOKEN` in `.env`, from Infisical ([`SECRETS.md`](SECRETS.md)). It's a
personal token made in Ranobe's _Settings › Connected apps_ with **Read
catalogue**, **Write library** and **Suggest entries** (`catalogue:read`,
`library:write`, `catalogue:write`). With no token, nothing here runs and
nothing is asked. `RANOBE_URL` points it elsewhere (`http://localhost:42145/api/v1`
for Ranobe's dev server). The e2e server's `TSUNDOKU_ANILIST=off`, or
`TSUNDOKU_RANOBE=off`, keeps it off the network.

Checked on 2026-09-27: the token authenticates, and the library was empty.

**`RANOBE_SUGGEST_TOKEN`**, the second token, is the app account's, with
`catalogue:read,catalogue:write` only. Every suggestion goes through it:
works and people (below), and editions. Without it, no work is suggested, and
a missing edition still goes through the owner's token, applied at once, as
it did before c72. Made once, on the VPS, in `/srv/ranobe`:

```sh
yarn run user:create tsundoku app
yarn run token:create tsundoku "Tsundoku suggestions" catalogue:read,catalogue:write
```

Then into Infisical (project `tsundoku`, `prod`) as `RANOBE_SUGGEST_TOKEN`,
`yarn run secrets:pull`, and a restart.

**In production those two don't run as written**: `/srv/ranobe` has no dev
dependencies, and the image bundles `create-user` but not `create-token`
(Ranobe card c86). Done on 2026-09-27 as:

```sh
docker exec ranobe-app node build/tools/create-user.mjs tsundoku app
# create-token.ts bundled on the workstation with tools:build's esbuild flags,
# then piped in: the container's root filesystem is read-only.
docker exec -i ranobe-app node --input-type=module - tsundoku "Tsundoku suggestions" \
  catalogue:read,catalogue:write < /tmp/create-token.mjs
```

Checked the same day: the token authenticates, and `/me/library/counts`
refuses it `403 insufficient_scope` (it's the app's, not the owner's).

## Privacy

What tsundoku never sends anywhere else, it never sends Ranobe, and that
covers **asking** as well as telling (step 0 of the contract). A hidden
series and anything from Hentoid is never looked up, never suggested and never
sent. `ELIGIBLE_SQL` in `src/lib/server/ranobe.ts` is the one place the rule is
spelled, and every query uses it; `ELIGIBLE_NOVEL_SQL` narrows it to novels
for the steps comics skip. Reading in incognito records no `read_at`,
so there is nothing for a send to follow.

**Hiding a series takes nothing back.** Its reads already on Ranobe stay
there, and nothing more is sent for it. Only what a series Ranobe may hear of
maps onto is ever sent or unsent.

## The pass

After every import (after the links and the AniList and MAL lists), and from
`yarn run ranobe`. It logs counts, never titles.

1. **Matching** (step 2). Every novel and comic with an AniList or MAL id is asked
   about with `POST /lookup`, and a work that answers is linked `via
'lookup'`. A cover-only link (a novel to its comic's entry, [`LINKS.md`](LINKS.md))
   is the comic's id, so it's never asked. Several series may share a work:
   The Eminence in Shadow is a series per EPUB volume (step 3). A series the
   owner UNLINKED or settled as NOT ON RANOBE is never linked again.
2. **Searching** (step 2's other half), novels only. A novel the ids didn't find is
   searched by title, `GET /search?kind=light_novel,web_novel`, with the
   volume taken off (`cleanTitle`: "The Beginning After The End 08" asks
   for "The Beginning After The End"). Only the title is sent. What it finds
   waits for the owner on `/links`: **a search never links**, since the
   contract leaves the choice to the owner.
3. **Editions**, novels only. `GET /works/{ref}` for each work still waiting. The edition
   in the series' language is taken (`entries.language`, English when none
   is recorded): licensed before original before fan, an ebook before print.
   With none, a suggestion (below).
4. **Comics' counts.** `GET /works/{ref}?fields=units` for every linked
   comic's work, kept in `ranobe_work_units`. Asked every pass, since counts
   grow.
5. **Units** (step 4). `GET /editions/{ref}?fields=units` once per edition,
   and each entry keeps its unit ref in `entries.ranobe_unit`; a comic's
   entries map onto its work's chapters instead. Mapped again every pass,
   since an import may add chapters.
6. **Sending** what's read (steps 7 and 8), marked `backfill` in the pass.
7. **Reading the library**, `GET /me/library`, for what Ranobe says of each
   linked work: status, progress in the edition's units, rating, FAV. Every
   send's answer updates it too. It's what the TRACKING line shows.

**Each step runs on its own.** A refusal in one (a search Ranobe turns down,
say) is logged and the rest go on, reads included. Ranobe out of reach
stops the pass, since every step after would fail the same way. SETTINGS'
LAST PASS is when it last ran (`settings.ranobe_pass_at`).

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

**Through the app account, they wait.** With `RANOBE_SUGGEST_TOKEN` set, an
edition suggestion waits for the owner on Ranobe like any other, and the pass
asks after it until it's decided. Without it, the owner's token sends it, and
a moderator's suggestion is applied as sent. That's what happened in the
first pass, 2026-09-27: bundles 1–5, approved at once with the owner as
reviewer.

## Suggesting a novel

For a novel Ranobe hasn't got (card c72; the contract's step 12). **Only on
the owner's tap**, SUGGEST TO RANOBE in the review's nothing-found state (1d),
and only with `RANOBE_SUGGEST_TOKEN`. Without it the row stays dimmed, NOT
YET, and says what it needs. Never for a hidden series or Hentoid.

1. **Ranobe is searched once more**, by the title with the volume cut off. If
   it has the work now, nothing is suggested: the candidates come back to
   choose from.
2. **The EPUB is read** (`parsePackage`: dc:title, dc:creator with its role,
   dc:language, dc:publisher, an ISBN among dc:identifier).
3. **One bundle, through the app account**: the authors as people, then the
   work crediting them (`workBundle`). `source` is `epub:<file name>`, and the
   `reason` says which parts are guesses.
   **A sibling volume joins it.** When another series with this one's title
   before a volume number already waits on a suggestion, SUGGEST joins that
   bundle instead of sending a second one: The Beginning After the End is
   seven series, and one novel. Its UNDO leaves the bundle standing for the
   others; only the last one out withdraws it.
4. **The series leaves the review** while it waits. Its LINK row says
   `SUGGESTED TO RANOBE · BUNDLE 7 · WAITS FOR YOUR REVIEW THERE`, and its
   TRACKING line `RANOBE · SUGGESTED, WAITING FOR YOUR REVIEW`. UNDO in the
   review withdraws the bundle (`POST /bundles/{id}/withdraw`).
5. **Each pass asks after it** (`checkWorkSuggestions`, before the search).
   Approved: the series is linked to the work it made, and its siblings (the
   same title before a volume number) are searched again in the same pass, so
   the new work comes to them as a candidate. Rejected or withdrawn on
   Ranobe: settled as NOT ON RANOBE, since the owner said no.

**What the files give, and what's guessed.** Measured on 2026-09-27 over the
15 unlinked novels: no ISBN and no publisher on any but a textbook, since
they're fan rips. So:

- **Authors** come cleaned (`suggestedPeople`). Only `aut` when the file gives
  roles. A placeholder ("To be implemented") or a ripper's credit ("Goldengato
  https://jnovels.com") is dropped. The same name spelt twice ("Turtle Me",
  "TurtleMe") is kept once. A native name in brackets is split out, "Sing-shong
  (싱숑)" becoming 싱숑 with Sing-shong as its romanisation, since Ranobe files
  a person under the native name. None left, and the work goes without an
  author.
- **The title** is the file's, with the volume cut off, in the file's own
  language, and never `official`. A second title in brackets goes along as
  an alias ("Second Life Ranker Novel (Ranker Who Lives Twice Novel)"). A
  translator group in the title ("… - Mythic Regressor") stays: no rule tells
  it from a subtitle, so the owner cuts it on Ranobe.
- **The kind is a guess**: a series that is one volume is a light novel, one
  of chapters a web novel.
- **The original language is the file's, on purpose, and says so.** Ranobe
  requires a title in a work's original language (its `snapshots.ts`: "A
  title in the original language is required"), and the only title the file
  has is the translation's. So `originalLang` is the file's language, and the
  real guess, from the authors' script (Hangul is Korean, kana Japanese, Han
  Chinese), goes in the `reason`: "probably ko · add the original title and
  fix it before approving". The first live suggestion, 2026-09-27, sent the
  guess as `originalLang` with only an English title, and Ranobe refused it
  `422 invalid_revision`. The specs' fake Ranobe now enforces the rule.
- **The other rules** Ranobe checks all hold: the kind is known, `author` is
  a credit role of both novel kinds, and nothing repeats.

Ranobe's bundle lists **duplicates** while it's pending: an existing person or
work whose name or title normalises the same. The owner sees them in the
review there. Tsundoku can't ask about people itself, since Ranobe's search
is works only.

## Comics

Card c98, since 2026-10-14. Ranobe's card c226 gave every work its own units
(`GET /works/{ref}?fields=units` answers `{ type, count, extra, open }`, or null),
and `POST /me/reads` takes them as `w123:chapter:154` beside an edition's
refs. A comic has no edition to choose, so it reads against those:

- **Linked by its ids only.** The pass asks `/lookup` with a comic's AniList
  and MAL ids, as it does a novel's. It never searches a comic by title:
  AniList links nearly every one, and the rest would fill the review. FIND
  and PASTE A LINK on a comic's screen still work, searching
  `kind=manga,manhwa,manhua`.
- **No edition, no suggestion.** `ranobe_links.edition` stays NULL and
  `volume` NULL; the edition steps and suggestions are novels only
  (`ELIGIBLE_NOVEL_SQL`).
- **Chapters from the label.** "Ch. 154", "Chapter 12.5", "Episode 3",
  "Vol.2 Ch.15 - …" (`comicChapterOf`). On 2026-10-13, 14,936 of the 15,370
  comic chapters read here were a plain whole number, 426 a fraction, 8
  something else (a prologue, an afterword).
- **Only what the work lists.** A chapter maps onto `w…:chapter:N` when N is
  in `1..count` or one of `extra`, since Ranobe refuses anything else, all or
  nothing, and never folds 12.5 into 12. A chapter past the count waits: the
  next pass that reads a higher count maps and sends it. A fraction the work
  doesn't list as an extra is never sent.
- **A running work takes any chapter** (since 2026-10-29, rung 52). Ranobe
  has, since its 2026-10-15, taken any number from 1 to 10,000, whole or
  not, on a work still coming out (`units.open: true`), past its count or
  with no count at all; the count caps only a finished one. tsundoku read
  only the count, so a running manga with none (Ane no Tomodachi: `count:
null`) mapped nothing and sent nothing, and a running one with a count
  dropped every chapter read past it. `ranobe_work_units.open_run` keeps the
  flag, `workLists` takes the open range, and the series line says `N
CHAPTERS SO FAR ON RANOBE`, or `STILL RUNNING ON RANOBE` with no count.
  Rung 52 clears every kept `type`, so the next pass asks each work again.
- **A work that counts nothing yet** maps nothing, and its TRACKING line says
  `RANOBE · WAITING ON ITS CHAPTER COUNT`. Ranobe was still filling its
  counts in when this shipped (AniList's chapters and MangaUpdates' latest,
  about 15 hours from 2026-10-14 02:40 UTC), so a comic may wait a pass or
  two.
- **Progress** comes back as the work's refs (`CH. 154 OF 179`), and the
  rest (rating, FAV, unreads, the backfill) is the same as a novel's.

## Anime

Card c240, since 2026-11-03. Ranobe's kinds include `anime`, and a seasonal
work's season-1 work is **one entry for the whole show** (Ranobe c134,
"Series": a seasonal kind's works joined by sequel relations are a series,
its entry on the season-1 work, and every season's units count in it). So
tsundoku sends an anime as one work, however many seasons its source lists:

- **One link for the series.** `ranobe_links` holds the work, and the series
  screen draws Ranobe as **one line under the season lines** in LINK and
  TRACKING -- never in AniList's place, since each season still has its own
  entry there. LINK: the work's title, `ONE ENTRY FOR ALL 4 SEASONS`, and
  RANOBE ↗, or **Not on Ranobe** with FIND. TRACKING: `WATCHING · EP. 57 OF
96` / `SENT 12 MIN AGO`, counted straight through the seasons (25 + 24 +
  8), since Ranobe keeps no seasons.
- **Linked by its ids, or shortened.** `/lookup` asks with the show's
  AniList id and its MAL id as **`mal_anime:`** (MAL's anime ids are their
  own sequence): those of its lowest linked season, so a show linked only
  from season 2 is asked about too (wave 17; `series_links` holds no mirror
  then). The pass does not search an anime by title: the relation
  page already offers the show's entries, and a title search would fill the
  review. FIND on its screen still searches (`kind=anime,donghua`).
- **Episodes, numbered through the seasons** (`mapAnimeUnits`). The work
  counts its own episodes, so season 1's EP. 24 is 24 and season 2's EP. 1 is
  25 -- the episode's place in the list, not the number the source printed
  twice. A recap and a half number take no number and are never sent (Ranobe
  refuses a fraction it doesn't list as an extra).
- **Only what the work lists,** as a comic: an episode past a finished
  work's count waits for the next pass that reads a higher one, and a
  running work takes any number to 10,000.
- **What is sent:** each episode read here, as one `w…:episode:N` read, with
  `entries.read_at` as its time; a mark-read-through sends every episode it
  marked. MARK UNREAD takes back the reads tsundoku sent, as for a novel.
  The rating and FAV are the work's, through `PUT /me/library/{work}`, and
  a write to a season's id sets that season's rating on Ranobe -- tsundoku
  sends the series' own.
- **A read-through fills every aired episode.** When the owner marks a show
  completed on Ranobe, Ranobe itself fills every aired episode of every
  season (its c134 / c146); tsundoku's part is to send the reads it made
  here, and to keep the unit numbering straight so those reads land on the
  right episodes.

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

**A link made by hand sends at once** (2026-10-29). A link pasted or picked
in the review, or a suggestion approved, used to wait for the next pass to
map its chapters onto units, and until then nothing read on it could go: a
comic's units are only mapped in the full pass. Ane no Tomodachi was read for
days on an unmapped link while Level 1 Player, linked by the lookup just
before a pass, synced. Now `afterLinking` (`ranobe.ts`) reads the new work's
units, maps that one series and flushes, off the request. A link that is
still unmapped heals itself too: the next read on it (`afterReading`) and the
series screen's RETRY both map it first (`unmapped`).

**Status isn't sent.** Ranobe works it out from the reads: the first read
adds a work as READING, and the last unit of the edition makes it COMPLETED.
A work rated before anything is read is added as PLANNING.

## The review

The link review at `/links` is AniList's and Ranobe's at once (Ranobe
Review, 1a–1f). An item is one series and one catalogue, so **a novel unsure
on both comes up twice, Ranobe first**: Ranobe is where its reads go. The
queue is every searched, unlinked, unsettled novel, a skipped one at the
back, then those with nothing found. With no token, none of it shows.

- **Candidates** are works, never editions: MATCHED (the title or alias that
  matched, often in another script), KIND, YEARS, STATUS, UNITS (`9 VOLUMES
· 470 CHAPTERS`), and why it's there (`TITLE EQUAL WITHOUT “VOL. 2”`,
  `MATCHED “本好きの下剋上”`). A cover Ranobe flags as sensitive is never
  drawn: **SENSITIVE · NOT SHOWN** stands in, as NO COVER does for none.
  OPEN ↗ goes to the work on `ranobe.ink`.
- **LINK** links the series `via 'review'`, and the next pass takes the
  edition (or suggests it), maps and sends.
- **THE SAME WORK FOR THESE?** (1b, the owner's pick over 1c). Right after
  LINK, the review lists the other series still waiting on Ranobe whose
  title, before a volume number, is this one's (`cleanTitle`, normalised).
  Nothing is preselected. TAP ALL N and LINK N MORE link the ones tapped;
  NOT THESE goes on. The rows say the volume and flag **A SECOND COPY** of
  one. A sibling left out leads with the work as candidate A, **CHOSEN FOR
  VOL. 2 JUST NOW** (1c). UNDO of the LINK takes that back, and gives back
  the sibling's own find of the work if it had one.
- **NONE OF THESE**, or **NOT ON RANOBE** with nothing found (1d): settled,
  never asked again, nothing sent. **SUGGEST TO RANOBE** is drawn dimmed, as
  NOT YET (step 12).
- **SKIP**, **SEARCH AGAIN** (Ranobe asked now; out of reach, it waits for
  the pass), **PASTE A LINK** (`ranobe.ink/w2`: only the id is read, with
  `GET /works/w2`), and **UNDO** for every one of them.
- **FIND** and **CHANGE** on a series screen open the review on that series
  alone (`/links?series=…&service=ranobe`). A hidden series may only PASTE,
  and is never offered as a sibling.

## The series screen

With a token, a novel's LINK and TRACKING rows are Ranobe's (Ranobe Series
2a–2k), in place of AniList's. The COVER row stays: a novel's cover can
still come from its AniList link, and the LINK row keeps that id in its
meta line.

- **LINK**: the work's title; `RANOBE W901 · ENGLISH EDITION · BY CHAPTER ·
2 SERIES SHARE IT · ANILIST 108428`, as far as each applies; RANOBE ↗,
  CHANGE, UNLINK. UNLINK is a decision: no pass links it again, and what was
  sent stays on Ranobe. Not linked: **Not on Ranobe**, why (candidates
  waiting, nothing found, settled), and FIND and PASTE A LINK. Hidden: **Not
  linked**, `HIDDEN SERIES ARE NEVER LOOKED UP ON RANOBE`, PASTE A LINK only.
- **TRACKING**, one line (`ranobeLines`): what Ranobe says, `RANOBE ·
READING · VOL. 5 OF 6 · 8`, and on the right what tsundoku did, SENT 12
  MIN AGO. Its other states:
  - A volume partly read here gets a quiet second line, `VOL. 6 · 6 OF 9
CHAPTERS READ HERE` / `SENT ONCE ALL 9 ARE` (2b), so a chapter that
    didn't go reads as expected.
  - A failed send: `RANOBE · VOL. 5 NOT SENT` and why, with TRY AGAIN. The
    second line says what to do: a new token, or that the edition has no
    such unit (2d–2f).
  - WAITING ON AN EDITION, with whether the suggestion was refused (2g).
    NOT ON RANOBE (2h). AS OF 14:20 offline (2i). Hidden: nothing sent (2j).
  - Linked but not read yet: `RANOBE · NOT IN YOUR LIBRARY YET` / `ADDED ON
THE FIRST READ`.
- **No EDIT.** Ranobe works status out from the reads, and the RATING row
  is what it gets.
- **On an anime** (c240) neither row is Ranobe's alone: the season lines
  come first and Ranobe is their last line, one for the whole show
  (`ONE ENTRY FOR ALL 4 SEASONS`). Its LINK cell is RANOBE ↗ or FIND; its
  TRACKING line is one (`RANOBE · WATCHING · EP. 57 OF 96`), with TRY AGAIN
  in the row's cells when it failed. No sheet edits Ranobe, on an anime as
  on a novel: its status is worked out from the reads.

## SETTINGS

A third row in 02 — CATALOGUES (3a–3c), 84px for its three lines:

- `Token in .env`, and the send line: `NOVELS · READ AND WRITTEN · LAST SENT
14:20`, or `4 UNITS NOT SENT · RANOBE DID NOT ANSWER · 09:14` with TRY
  AGAIN.
- The pass's line (3c): `LAST PASS 14:20 · 8 LINKED · 1 TO CHOOSE · 14 NOT
ON RANOBE`. **TO CHOOSE** counts series with candidates and opens
  `/links`; **NOT ON RANOBE** counts those settled so or with nothing found.
  The two never count a series twice. TO CHOOSE is left out at 0.
- No token: `Not configured`, `NO TOKEN · RANOBE_TOKEN IN .ENV`, nothing to
  tap.

The section's TO REVIEW count, and the library's links band, count Ranobe's
queue with AniList's: it's one review.

## Where it departs from the handoff

- **SUGGEST TO RANOBE** (1d) was drawn dimmed, `LATER · FROM THE EPUB’S OWN
TITLE, AUTHOR, PUBLISHER AND ISBN` / `NOT YET`. With the app account's token
  it's live: `FROM THE EPUB’S OWN TITLE AND AUTHOR · WAITS FOR YOUR REVIEW ON
RANOBE`, with a SUGGEST cell. Publisher and ISBN go unmentioned, since the
  files have neither. Without the token it's the mock's row, saying what's
  missing (card c72).
- **"Token for masshiro"** reads **Token in .env**. Ranobe has no endpoint
  naming a token's account (`/me/tokens` is session-only), so the name
  can't be known from here.
- **The mock's counts** (2,326 LINKED, 14 NOT ON RANOBE, 05 OF 12) are the
  database's.
- **The mock's kinds**: its THIS SERIES meta says LIGHT NOVEL or WEB NOVEL.
  tsundoku has one kind, novel, and says NOVEL. The candidate's KIND row has
  no "· SAME": there is nothing finer to compare it with.
- **The sibling rule** is the title before a volume number, as the mock
  says, but not "their candidates were the same": a sibling not searched yet
  is offered too. Nothing is preselected, so nothing is linked unasked.
- **SEARCH AGAIN's field** isn't drawn in Ranobe Review. It's the link
  review's own, with Ranobe's words.
- **SKIP** is there when Ranobe found candidates (1a), as on AniList's
  review. With nothing found the actions are the mock's three (1d).

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

Part 2's first pass, on a copy of the live database, searched the 15
novels still unlinked, and **Ranobe found nothing for any of them**: they
are the Korean web novels it doesn't have yet, and a textbook. So today the
review shows 15 NOT ON RANOBE decisions to make, and The Beginning After
the End is 7 of them, one per volume.

## Not yet

- **A comic's chapter Ranobe doesn't count.** Sent once Ranobe's count
  reaches it; a fraction only if an editor adds it as an extra there.

- **NOT ON RANOBE for the siblings.** The sibling list only follows a LINK.
  Settling The Beginning After the End as not on Ranobe is seven decisions
  today, one per volume. The same list after NOT ON RANOBE would make it one,
  and would need its own drawing.
- **The suggestions waiting on review**, on a screen of their own. SETTINGS
  counts them (`N SUGGESTED`) and each series says so, but the list is
  Ranobe's queue.
- **Suggesting on import**, without a tap. Deliberately not: the owner
  decided each one should be asked for.
- **Rereads** (step 10): a new read-through. Today a read sent again lands in
  the current one as a duplicate.
- **The other direction** (step 11): `GET /me/reads?since=` and
  `/me/library?since=`, for what changed on the site.
- **Freshness** (step 5): `GET /changes?since=` for titles and covers.
