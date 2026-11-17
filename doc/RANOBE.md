# Ranobe

**Ranobe** (`ranobe.ink`) is a catalogue and reading-list site for light
novels, web novels, comics and anime, with an API for apps. tsundoku keeps a
Ranobe library moving from what's read and watched here: which works are in
it, how far each is read, its rating and its favourite. Four kinds go there,
the four `RANOBE_KINDS` holds (`src/lib/library/ranobe.ts`): **novels**, read
against an edition's volumes or chapters; **manga** and **manhwa**, read as
the work's own chapters ("Comics" below), which go to AniList and MAL as well;
and **anime**, one Ranobe work for the whole show, its episodes counted
straight through every season ("Anime" below), beside AniList's entry a
season. A doujin goes nowhere. The contract it's built against is Ranobe's API
v1, "For Tsundoku", and the steps below use its numbers.

- Code:
  - `src/lib/library/ranobe.ts`: the pure rules (volumes, units, editions,
    the review's lines, Ranobe's line on the series screen's LISTS row).
  - `src/lib/server/ranobe.ts`: the client, the pass, the sends, searching.
  - `src/lib/server/ranobe-review.ts`: the review's queue and decisions, and
    what the series screen and SETTINGS read.
  - `src/routes/api/links/ranobe/`: the review's decisions.
  - `src/routes/links/`: the review, AniList's and Ranobe's.
  - The series screen's `?/unlinkRanobe` and `?/retryRanobe`; SETTINGS'
    `?/retryRanobe`.
  - `scripts/ranobe.ts`: `yarn run ranobe`, the pass by hand.
- Migration 31: `ranobe_links`, `entries.ranobe_unit`, `ranobe_units`,
  `ranobe_works`, `ranobe_suggestions`. Migration 32: `ranobe_searches`,
  `ranobe_candidates`, `ranobe_decisions`, and Ranobe's own word on each work
  in `ranobe_works`. Migration 38: `ranobe_work_units`, what each comic's work
  counts.
- Specs: `tests/ranobe-domain.spec.ts`, `tests/ranobe-db.spec.ts`,
  `tests/ranobe-review-db.spec.ts`, `tests/ranobe-flow.e2e.ts`.

## Ground rules

- **Novels, manga, manhwa and anime.** Manga and manhwa go to both AniList
  and Ranobe. Doujinshi never, whichever importer made them: Hentoid's books,
  or a Mihon gallery source's series.
- **A missing edition is suggested.** Ranobe mostly has a work's Japanese
  original, and the EPUBs here are usually English. A series waits for an
  edition in its own language, and when there's none, the pass suggests one to
  Ranobe for review there. Nothing of that work is sent until it's approved.
  Mapping English volumes onto the Japanese edition would sync at once, and
  would say the Japanese volumes were read.
- **Suggestions go through an app account and wait.** A moderator's token
  applies anything it suggests at once, and the EPUBs' metadata is too rough
  for that. tsundoku suggests through a Ranobe app account instead, whose
  edits always wait for a reviewer, who corrects them in Ranobe's own editor
  before approving. The personal token stays for the library.

## The token

`RANOBE_TOKEN` in `.env` ([`SECRETS.md`](SECRETS.md)). It's a personal token
made in Ranobe's _Settings › Connected apps_ with **Read catalogue**, **Write
library** and **Suggest entries** (`catalogue:read`, `library:write`,
`catalogue:write`). With no token, nothing here runs and nothing is asked.
`RANOBE_URL` points it elsewhere (`http://localhost:42145/api/v1` for Ranobe's
dev server). The e2e server's `TSUNDOKU_ANILIST=off`, or `TSUNDOKU_RANOBE=off`,
keeps it off the network.

**`RANOBE_SUGGEST_TOKEN`**, the second token, is the app account's, with
`catalogue:read,catalogue:write` only. Every suggestion goes through it: works
and people (below), and editions. Without it, no work is suggested, and a
missing edition goes through the personal token, applied at once. The account
and its token are made on the Ranobe server:

```sh
yarn run user:create tsundoku app
yarn run token:create tsundoku "Tsundoku suggestions" catalogue:read,catalogue:write
```

Then it goes into `.env` as `RANOBE_SUGGEST_TOKEN`, and tsundoku is restarted.
The app's token is refused `/me/library/counts` (`403 insufficient_scope`):
it has no library of its own.

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

**NEVER TRACKED is narrower than hidden** (a switch on a source's settings
page, [`BROWSE.md`](BROWSE.md), "A source's own switches"). Nothing is
**written** or **offered** to Ranobe for it: `resolveEditions` skips a work
only its series link (no lookup, no edition suggestion, and its volumes never
build another series' reason), `worksOf` finds no work to send for, `flush`
skips its units and a work only it read, and SUGGEST TO RANOBE is refused
(`fromFile`), so no bundle is posted. A queued read or a work's rating is
**kept**, as a hidden series' is, and goes once the switch is off. A search or
a lookup by id still asks, because neither writes anything and a link is how a
cover and its details arrive; that is the one thing this switch lets out.

A unit another series shares is not a way round it: `refreshUnits` counts no
read from a never-tracked series, even when an eligible series maps the same
unit, so the unit is only as read as that other series holds it. A unit
already sent before the switch went on, with no read left from a series Ranobe
may hear of, is **withdrawn** (a `DELETE`) while another series keeps it live:
that takes back the very read the switch forbids, and its `sent_at` is cleared
so it is not withdrawn twice (turning the switch off sends the read again from
what that series holds then). With no other series mapping the unit, the
drain's `live` guard leaves the row alone, as it leaves a hidden series'.

## The pass

After every import (after the links and the AniList and MAL lists), and from
`yarn run ranobe`. It logs counts, never titles.

1. **Matching** (step 2). Every novel and comic with an AniList or MAL id is asked
   about with `POST /lookup`, and a work that answers is linked `via
'lookup'`. A cover-only link (a novel to its comic's entry, [`LINKS.md`](LINKS.md))
   is the comic's id, so it's never asked. Several series may share a work:
   a novel imported as one EPUB per volume is a series per volume (step 3). A
   series UNLINKED or settled as NOT ON RANOBE is never linked again.
2. **Searching** (step 2's other half), novels only. A novel the ids didn't find is
   searched by title, `GET /search?kind=light_novel,web_novel`, with the
   volume taken off (`cleanTitle`: "The Beginning After The End 08" asks
   for "The Beginning After The End"). Only the title is sent. What it finds
   waits on `/links`: **a search never links**, since the contract leaves the
   choice to the user.
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
   send's answer updates it too. It's what Ranobe's line on LISTS shows.

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
reads. Half a volume read sends nothing. Two copies of one volume (two series
for the same volume 8) count once: read in either is read.

## Editions, suggested

A work with no edition in the series' language gets one suggested, once per
work and language, as a one-item bundle (`POST /bundles`):

- `lang` the series', `origin: licensed`, `format: ebook`: the likeliest for
  an English EPUB, and a reviewer checks it either way.
- Its units are volumes 1 to the highest this library holds of the work,
  since an English volume 5 means there were four before it.
- The `reason` names the volumes held, never a title or a file.

`ranobe_suggestions` keeps the bundle. Each pass asks `GET /bundles/{id}`
until it's decided. Approved, its edition becomes the series' and the pass
maps and sends at once. Rejected or withdrawn, it's never suggested again.
A suggestion that couldn't be sent is tried again.

**Through the app account, they wait.** With `RANOBE_SUGGEST_TOKEN` set, an
edition suggestion waits for review on Ranobe like any other, and the pass
asks after it until it's decided. Without it, the personal token sends it,
and a moderator's suggestion is applied as sent.

## Suggesting a novel

For a novel Ranobe hasn't got (the contract's step 12). **Only on a tap**,
SUGGEST TO RANOBE in the review's nothing-found state, and only with
`RANOBE_SUGGEST_TOKEN`. Never for a hidden series or Hentoid.

With the token the row reads `FROM THE EPUB’S OWN TITLE AND AUTHOR · WAITS FOR
YOUR REVIEW ON RANOBE`, with a SUGGEST cell; publisher and ISBN go unmentioned,
since fan-ripped files have neither. Without it the row stays dimmed, NOT YET,
and says what it needs.

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
   bundle instead of sending a second one: a novel imported a volume at a time
   is several series and one work. Its UNDO leaves the bundle standing for the
   others; only the last one out withdraws it.
4. **The series leaves the review** while it waits. Its Ranobe line on LISTS
   says `SUGGESTED TO RANOBE · BUNDLE 7 · WAITS FOR YOUR REVIEW THERE`, and
   under it `SUGGESTED, WAITING FOR YOUR REVIEW`. UNDO in the
   review withdraws the bundle (`POST /bundles/{id}/withdraw`).
5. **Each pass asks after it** (`checkWorkSuggestions`, before the search).
   Approved: the series is linked to the work it made, and its siblings (the
   same title before a volume number) are searched again in the same pass, so
   the new work comes to them as a candidate. Rejected or withdrawn on
   Ranobe: settled as NOT ON RANOBE.

**What the files give, and what's guessed.** Fan-ripped EPUBs carry no ISBN
and no publisher; of the novels this was first measured on, only a textbook
had either. So:

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
  it from a subtitle, so the reviewer cuts it on Ranobe.
- **The kind is a guess**: a series that is one volume is a light novel, one
  of chapters a web novel.
- **The original language is the file's, on purpose, and says so.** Ranobe
  requires a title in a work's original language ("A title in the original
  language is required"), and the only title the file has is the
  translation's. So `originalLang` is the file's language, and the real guess,
  from the authors' script (Hangul is Korean, kana Japanese, Han Chinese),
  goes in the `reason`: "probably ko · add the original title and fix it
  before approving". Sending the guess as `originalLang` with only an English
  title is refused `422 invalid_revision`, and the specs' fake Ranobe enforces
  the rule.
- **The other rules** Ranobe checks all hold: the kind is known, `author` is
  a credit role of both novel kinds, and nothing repeats.

Ranobe's bundle lists **duplicates** while it's pending: an existing person or
work whose name or title normalises the same. The reviewer sees them there.
tsundoku can't ask about people itself, since Ranobe's search is works only.

## Comics

Every Ranobe work counts its own units (`GET /works/{ref}?fields=units`
answers `{ type, count, extra, open }`, or null), and `POST /me/reads` takes
them as `w123:chapter:154` beside an edition's refs. A comic has no edition to
choose, so it reads against those:

- **Linked by its ids only.** The pass asks `/lookup` with a comic's AniList
  and MAL ids, as it does a novel's. It never searches a comic by title:
  AniList links nearly every one, and the rest would fill the review. FIND
  and PASTE A LINK on a comic's screen still work, searching
  `kind=manga,manhwa,manhua`.
- **No edition, no suggestion.** `ranobe_links.edition` stays NULL and
  `volume` NULL; the edition steps and suggestions are novels only
  (`ELIGIBLE_NOVEL_SQL`).
- **Chapters from the label.** "Ch. 154", "Chapter 12.5", "Episode 3",
  "Vol.2 Ch.15 - …" (`comicChapterOf`). Measured over 15,370 comic chapters,
  14,936 were a plain whole number, 426 a fraction, 8 something else (a
  prologue, an afterword).
- **Only what the work lists.** A chapter maps onto `w…:chapter:N` when N is
  in `1..count` or one of `extra`, since Ranobe refuses anything else, all or
  nothing, and never folds 12.5 into 12. A chapter past the count waits: the
  next pass that reads a higher count maps and sends it. A fraction the work
  doesn't list as an extra is never sent.
- **A running work takes any chapter** (migration 52). Ranobe takes any
  number from 1 to 10,000, whole or not, on a work still coming out
  (`units.open: true`), past its count or with no count at all; the count caps
  only a finished one. `ranobe_work_units.open_run` keeps the flag, `workLists`
  takes the open range, and the series line says `N CHAPTERS SO FAR ON
RANOBE`, or `STILL RUNNING ON RANOBE` with no count. Migration 52 clears
  every kept `type`, so the next pass asks each work again.
- **A work that counts nothing yet** maps nothing, and its line on LISTS says
  `WAITING ON ITS CHAPTER COUNT`.
- **Progress** comes back as the work's refs (`CH. 154 OF 179`), and the
  rest (rating, FAV, unreads, the backfill) is the same as a novel's.

## Anime

Ranobe's kinds include `anime`, and a seasonal work's season-1 work is **one
entry for the whole show** (on Ranobe, a seasonal kind's works joined by
sequel relations are a series, its entry on the season-1 work, and every
season's units count in it). So tsundoku sends an anime as one work, however
many seasons its source lists:

- **One link for the series.** `ranobe_links` holds the work, and the series
  screen draws Ranobe as **one line under the season lines** on LISTS, a
  rule above it -- never in AniList's place, since each season still has
  its own entry there. The line: the work's title, `RANOBE · ONE ENTRY FOR
ALL 4 SEASONS`, `WATCHING · EP. 57 OF 96` / `SENT 12 MIN AGO`, counted
  straight through the seasons (25 + 24 + 8), since Ranobe keeps no
  seasons, and EDIT; or **Not on Ranobe** with FIND.
- **Linked by its ids, or shortened.** `/lookup` asks with the show's
  AniList id and its MAL id as **`mal_anime:`** (MAL's anime ids are their
  own sequence): those of its lowest linked season, so a show linked only
  from season 2 is asked about too (`series_links` holds no mirror then).
  Ranobe's review and its series rows name the same ids (`LINK_IDS_SQL`):
  `ANILIST 9600` for a show linked only from season 2, not NOT LINKED. The
  pass does not search an anime by title: the relation page already offers
  the show's entries, and a title search would fill the review. FIND on its
  screen still searches (`kind=anime,donghua`).
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
- **A read-through fills every aired episode.** A show marked completed on
  Ranobe has every aired episode of every season filled by Ranobe itself;
  tsundoku's part is to send the reads it made here, and to keep the unit
  numbering straight so those reads land on the right episodes.

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

**A link made by hand sends at once.** A link pasted or picked in the review,
or a suggestion approved, would otherwise wait for the next pass to map its
chapters onto units, and nothing read on it could go until then: a comic's
units are only mapped in the full pass. So `afterLinking` (`ranobe.ts`) reads
the new work's units, maps that one series and flushes, off the request. A
link that is still unmapped heals itself too: the next read on it
(`afterReading`) and the series screen's RETRY both map it first
(`unmapped`).

**Status isn't sent.** Ranobe works it out from the reads: the first read
adds a work as READING, and the last unit of the edition makes it COMPLETED.
A work rated before anything is read is added as PLANNING.

## The review

The link review at `/links` is AniList's and Ranobe's at once. An item is one
series and one catalogue, so **a novel unsure on both comes up twice, Ranobe
first**: Ranobe is where its reads go. The queue is every searched, unlinked,
unsettled novel, a skipped one at the back, then those with nothing found.
With no token, none of it shows.

- **Candidates** are works, never editions: MATCHED (the title or alias that
  matched, often in another script), KIND, YEARS, STATUS, UNITS (`9 VOLUMES
· 470 CHAPTERS`), and why it's there (`TITLE EQUAL WITHOUT “VOL. 2”`,
  `MATCHED “本好きの下剋上”`). A cover Ranobe flags as sensitive is never
  drawn: **SENSITIVE · NOT SHOWN** stands in, as NO COVER does for none.
  OPEN ↗ goes to the work on `ranobe.ink`. The candidate's KIND row has no
  "· SAME": tsundoku has one kind, novel, so there is nothing finer to compare
  it with, and THIS SERIES says NOVEL.
- **LINK** links the series `via 'review'`, and the next pass takes the
  edition (or suggests it), maps and sends.
- **THE SAME WORK FOR THESE?** Right after LINK, the review lists the other
  series still waiting on Ranobe whose title, before a volume number, is this
  one's (`cleanTitle`, normalised), whether or not they have been searched
  yet. Nothing is preselected, so nothing is linked unasked. TAP ALL N and
  LINK N MORE link the ones tapped; NOT THESE goes on. The rows say the volume
  and flag **A SECOND COPY** of one. A sibling left out leads with the work as
  candidate A, **CHOSEN FOR VOL. 2 JUST NOW**. UNDO of the LINK takes that
  back, and gives back the sibling's own find of the work if it had one.
- **NONE OF THESE**, or **NOT ON RANOBE** with nothing found: settled,
  never asked again, nothing sent. **SUGGEST TO RANOBE** beside them
  ("Suggesting a novel", above).
- **SKIP** when Ranobe found candidates, as on AniList's review (with nothing
  found the actions are the three above), **SEARCH AGAIN** (Ranobe asked now,
  in the link review's own field with Ranobe's words; out of reach, it waits
  for the pass), **PASTE A LINK** (`ranobe.ink/w2`: only the id is read, with
  `GET /works/w2`), and **UNDO** for every one of them.
- **FIND** and **CHANGE** on a series screen open the review on that series
  alone (`/links?series=…&service=ranobe`). A hidden series may only PASTE,
  and is never offered as a sibling.

## The series screen

With a token, Ranobe has **its own line on LISTS**. [`SERIES.md`](SERIES.md),
"LISTS", has the row whole. The line that tracks comes first: on a **novel**,
Ranobe's line leads, and AniList's link stays under it for the cover and
details (`COVER AND DETAILS · TRACKED ON RANOBE`; `Tracking.catalogueTracks`,
since AniList and MAL take no novel's progress); on a **comic**, AniList's
line leads and Ranobe's is under it; on an **anime**, Ranobe's one line is
under the seasons. The COVER row stays its own.

- **The line**: RNB, the work's title, and its meta, `RANOBE W901 · ENGLISH
EDITION · BY CHAPTER · 2 SERIES SHARE IT · ANILIST 108428` as far as each
  applies (`ONE ENTRY FOR THE SERIES`, or `… FOR ALL 4 SEASONS`, on an anime).
  Then what Ranobe says (`ranobeLines`, without its `RANOBE · ` lead, since
  the tag says it): `READING · VOL. 5 OF 6 · 8`, and on the right what
  tsundoku did, SENT 12 MIN AGO. Its other states:
  - A volume partly read here gets a quiet second line, `VOL. 6 · 6 OF 9
CHAPTERS READ HERE` / `SENT ONCE ALL 9 ARE`, so a chapter that didn't go
    reads as expected.
  - A failed send: `VOL. 5 NOT SENT` and why, in ink, with the line's own
    TRY AGAIN (`?/retryRanobe`). The quiet line under it says what to do: a
    new token, or that the edition has no such unit.
  - WAITING ON AN EDITION, with whether the suggestion was refused. AS OF
    14:20 offline. Hidden: nothing sent.
  - Linked but not read yet: `NOT IN YOUR LIBRARY YET` / `ADDED ON THE FIRST
READ`.
- **Not linked**: **Not on Ranobe** and why (candidates waiting, nothing
  found, settled, a suggestion waiting), and FIND and PASTE A LINK (FIND
  alone on an anime). Hidden: **Not linked**, `HIDDEN SERIES ARE NEVER LOOKED
UP ON RANOBE`, PASTE A LINK only, as the accent.
- **EDIT opens the sheet on the entry, with nothing to set.** Ranobe works
  status out from the reads, and the RATING row and FAV are what it gets, so
  the sheet has no STATUS buttons: its ENTRY holds RANOBE ↗, CHANGE and
  UNLINK. UNLINK is a decision: no pass links it again, and what was sent
  stays on Ranobe. Offline, EDIT turns into OPEN ↗ (the work on Ranobe) and
  every other cell dims.

## SETTINGS

A third row in 02 — CATALOGUES, 84px for its three lines:

- `Token in .env` (Ranobe has no endpoint naming a token's account:
  `/me/tokens` is session-only), and the send line: `NOVELS · READ AND WRITTEN
· LAST SENT 14:20`, or `4 UNITS NOT SENT · RANOBE DID NOT ANSWER · 09:14`
  with TRY AGAIN.
- The pass's line: `LAST PASS 14:20 · 8 LINKED · 1 TO CHOOSE · 14 NOT ON
RANOBE`, and `N SUGGESTED` while suggestions wait. **TO CHOOSE** counts
  series with candidates and opens `/links`; **NOT ON RANOBE** counts those
  settled so or with nothing found. The two never count a series twice. TO
  CHOOSE is left out at 0.
- No token: `Not configured`, `NO TOKEN · RANOBE_TOKEN IN .ENV`, nothing to
  tap.

The section's TO REVIEW count, and the library's links band, count Ranobe's
queue with AniList's: it's one review.

## Limits

- **A comic's chapter Ranobe doesn't count** is sent once Ranobe's count
  reaches it; a fraction only if an editor adds it as an extra there.
- **NOT ON RANOBE for the siblings.** The sibling list only follows a LINK, so
  settling a novel imported a volume at a time as not on Ranobe is one
  decision per volume.
- **The suggestions waiting on review** have no screen here. SETTINGS counts
  them and each series says so, but the list is Ranobe's queue.
- **Nothing is suggested on import**, without a tap, on purpose: each
  suggestion is asked for.
- **Rereads** (step 10): a read sent again lands in the current read-through
  as a duplicate, not in a new one.
- **Only one direction** (step 11): what changed on the site
  (`GET /me/reads?since=`, `/me/library?since=`) is not read back, nor are
  titles and covers refreshed from `GET /changes?since=` (step 5).
