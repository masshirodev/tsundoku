# GET STARTED: seven steps in two parts

What a friend's empty install shows instead of "Nothing imported yet" (cards
c208, c209). SET UP's four steps get tsundoku ready; FIRST READ's three walk
through what it's for: find something, keep it, download it.

- SET UP: the brief was [`briefs/GETTING-STARTED.md`](briefs/GETTING-STARTED.md);
  the design is the Getting Started handoff, `doc/design/handoff/Start-*.dc.html`
  (its decisions in `Start Calls.dc.html`).
- FIRST READ: the brief was [`briefs/FIRST-READ.md`](briefs/FIRST-READ.md),
  from the owner on 2026-10-31 ("ppl learn how to read repos and whatnot but
  not how to search, add to library and download stuff"); the design is
  `doc/design/handoff/FirstRead-*.dc.html` (its decisions in
  `FirstRead Calls.dc.html`).

Its other half, the update modal, is [`UPDATES.md`](UPDATES.md), "Told on
entry"; HELP is [`HELP.md`](HELP.md). Its words are in English and
Portuguese ([`I18N.md`](I18N.md)).

## The steps

| #   | Part       | Step                             | Ticks itself when                                                | Its link (and trip)                         |
| --- | ---------- | -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| 01  | SET UP     | Add a repository                 | a repository of any kind is kept                                 | ASK: EXTENSIONS › REPOSITORIES, `?add=`     |
| 02  | SET UP     | Install an extension             | an extension or a novel plugin is installed                      | AVAILABLE EXTENSIONS →                      |
| 03  | SET UP     | Bring a library you already have | a series an import or a scan brought in is in the library        | IMPORT A BACKUP →, and START SCAN, here     |
| 04  | SET UP     | Read on your phone               | a device pairs, or a phone, tablet or TV has checked in (below)  | SETTINGS › 08 — DEVICES →                   |
| 05  | FIRST READ | Find something to read           | a chapter or an episode is opened from a source (a record)       | the search, or a source's BROWSE →          |
| 06  | FIRST READ | Add it to your library           | a series from a source is in the library (ADD, ADD AND DOWNLOAD) | the last record's preview, OPEN →           |
| 07  | FIRST READ | Download chapters                | a chapter or an episode is queued or downloaded, of any series   | the series 06 added (or the newest), OPEN → |

- **What's there decides, not a press** (`src/lib/server/start.ts`, a few
  COUNT(\*)s the layout asks on every page). The rules are pure,
  `src/lib/library/start.ts`. A hidden series ticks nothing for someone who
  can't see it.
- **04, exactly** (c722): `phones` in `startFacts` is the number of
  `paired_devices` rows plus the `devices` rows whose kind is `phone`,
  `tablet` or `tv`. A row in `paired_devices` is written by the pairing
  itself, before the phone has loaded anything: `/pair/<code>` (a phone's
  scan of the WI-FI code) and `/pair/tv` (the app's six digits) both call
  `addPaired`. So a phone ticks 04 the moment its code is redeemed, whether
  or not its tab ever sends a request with the new cookie. A `devices` row
  is written by a browser's check-in (`POST /api/devices/sync`): a paired
  phone's first one, a browser that opened SETTINGS, or any browser with a
  setting to keep. Two things take a tick away again: SIGN OUT on a paired
  device's row (deletes its `paired_devices` row; its `devices` row, if it
  checked in as a phone, still counts), and a device unseen for 180 days
  (`FORGET_MS`, deleted at the next check-in).
- **What ticks a step without a reload** (c722). A step is ticked by what
  is there, and much of it arrives from elsewhere: a phone pairing, a
  download finishing, another tab. The list is the layout's load, which a
  client-side navigation reruns only when something it depends on changes,
  and nothing it reads does. So the open list asks for itself again
  (`pollStart` in `src/lib/start-trail.svelte.ts`, the layout's
  `tsundoku:start` key): on `/start`, every 5 s while the page is in view
  and the list isn't finished, and once whenever the page comes back into
  view or the window regains focus; a hidden page asks nothing. A trip's
  band does the same on its screen (below), and SETTINGS reloads every load
  when the WI-FI panel's poll sees its code used. **The empty library's
  list does not ask yet**: the library page had no owner in wave 33, and the
  one-effect patch for it is in `doc/handoff-notes/friends.md`, wave 33,
  Gaps. Until it lands, a list on the empty library ticks on the next
  navigation that reruns the layout, or a reload.
- **03 and 06 tell a series apart by how it came.** One ADD made has the
  source's key (`origin_key`) and no scan (`scan_job_id` is NULL); anything a
  scan or a backup brought in has the scan's id, or no key at all. A backup
  chosen on IMPORT A BACKUP runs as a scan job too ([`IMPORT.md`](IMPORT.md)),
  so its series carry its job's id and tick 03. So 06 never ticks 03, and an
  imported Mihon library never ticks 06.
- **03's done row names the door that ticked it** (c511, c634; Import-Doors
  B) on `/start` and on the library's empty list: `Done · Mihon backup · 382
series` when the series that first ticked 03 came from an import's job,
  else the step's own `Done · 4 series` and LIBRARY → to `/`. **"The series
  that first ticked 03" is not recorded**, so it is derived: the lowest id
  among the visible series 03 counts (SQLite hands a new row the highest id
  plus one, so that is the first one still there), and its `scan_job_id`
  where an `imports` row has that job (`tickingImport`,
  `src/lib/server/import/log.ts`). A scan's job, a series with no job at all
  (written before jobs, or by hand), or none, keeps the scan's line. Only a
  finished import names it: one still running, or one that failed partway,
  has a partial count and has not ticked anything as done, so the row takes
  only an `imports` row whose `state = 'done'` (the rule `lastImport` holds)
  and keeps the scan's line until then. So a
  later import no longer takes the row over: a library scanned in first (300
  series) and a 2-series backup after it reads the scan's line, `Done · 302
series`, and only a backup that came first names itself. The count is the
  import's own, counted as the viewer may see it, so a backup whose series
  are all hidden later leaves the scan's line while reveal is off. When the
  import's line draws, its quiet link is **IMPORT LOG →**, which opens that
  import's entry in the log, already open (`/import/log?open=backup:<id>`).
- **03's body** (c438; the import handoff's Import-Doors A) is the three
  backups first: Mihon backup with IMPORT A BACKUP → to `/import`, Aniyomi
  and LNReader dimmed, NOT YET. Under them, FILES INSTEAD · EPUBS, AND
  DOWNLOADED CHAPTERS: the library folder with START SCAN beside it, the way
  for files. Its tick line says an import or a scan.
- **05 counts browsing records**, written on the first chapter or episode
  opened from a source, never by the preview alone; forgotten ones still
  count (the row stays, [`BROWSING.md`](BROWSING.md)).
- **Done wins.** A later FIRST READ step ticks the ones before it: ADD AND
  DOWNLOAD on a preview ticks 05, 06 and 07 at once, and the earlier ones say
  `Done · with 06` (or 07). A step done after a skip is done.
- **02 waits on 01; FIRST READ waits on 02**: `After 02 · no source to search
yet`, its part's head `AFTER 02`. No SKIP while blocked: skipping the step
  it waits on is the way to say no.
- **SKIP on any step, UNDO brings it back.** Skipping 01 takes 02 and
  FIRST READ with it, skipping 02 takes FIRST READ (`Skipped with 01`, `3
SKIPPED WITH 02`), with no UNDO of their own: the skipped step's UNDO
  brings them back. A FIRST READ step skipped on its own takes nothing with
  it. Skips are kept on the computer (the `start_skipped` setting), so the PC
  and a paired phone show the same list.
- **Which step opens by itself**: FIRST READ's first step to do, ahead of
  SET UP's (once a source is installed, reading is what tsundoku was
  installed for); otherwise the first step to do.
- **Finished** is all seven done or skipped: the list stops appearing by
  itself and the sidebar's row goes.
- **01 names no repository.** It says where one comes from (ask the friend
  who gave you tsundoku, or search), what each kind holds and its file name,
  and offers three search phrases to COPY (no clipboard over plain-http
  Wi-Fi: the words are there to type). The owner, 2026-10-30: "we don't point
  the user at it, but we give them all the tools they need to find it".

## The two parts

- **Each part has a head**: `SET UP · 2 OF 4 DONE · ANY ORDER`, `FIRST READ ·
0 OF 3 · IN ORDER`, or what it waits on (`AFTER 02`, `3 SKIPPED WITH 02`),
  or `2 OF 3 DONE · 1 SKIPPED`.
- **A finished part folds to one row**, `✓ Set up · 3 done · 1 skipped ·
repository, extension, phone` (the phone drops the names), with SHOW ↓. A
  part gone wholly with another step's skip doesn't fold: its rows say why.
- **SET UP finished first turns the head to FIRST READ**: `00 — GET STARTED ·
FIRST READ`, `Set up. Now something to read.`
- **The open steps show what to do with**: 05 the search across the sources
  and each source with BROWSE →; 06 a replica of the preview's bar (drawn,
  not pressed) and WHAT YOU READ, the last browsing record, whose OPEN →
  starts the trip on its preview (with none, SEARCH →); 07 a replica of the
  DOWNLOAD row, what downloads for each kind, and IN YOUR LIBRARY, the series
  06 added or the library's newest, whose OPEN → starts the trip on its
  series screen. `firstReadExtras()` in `server/start.ts` gathers them.

## Where it shows

- **The empty library** is the list (`00 — GET STARTED`, `Nothing here
yet.`) until it's finished; then the first day (board 3): `Everything is
one search away.`, the sources' search, the sources with BROWSE →, and the
  library folder with START SCAN. With no sources at all, just the folder.
  Since FIRST READ, the first day is only what an empty library shows once
  GET STARTED is finished, which now takes skipping FIRST READ, or removing
  every series again; its search is 05's on the way in.
- **Once the library isn't empty** (06 puts a series in it), the list lives
  on at `/start`: the sidebar's row and the band lead there. Nothing new
  appears over the shelves.
- **`/start`**, a page of its own: the same list, on any install, finished or
  not, so the owner's workstation shows what friends get. HELP's first topic
  opens it; HELP's 03 opens it at FIRST READ (`/start#first-read`).
- **The sidebar's foot** starts with `GET STARTED 2 / 7` (accent count) until
  it's finished; on the tablet and phone, MORE's first row. The count is done
  and skipped together, both parts: how far through the whole list, as its
  head says done and skipped apart.

## The way back

The owner's worry was how a friend gets back to the list after a step sent
them off. A step's link starts a **trip** (`src/lib/start-trail.svelte.ts`):
the screen it opens wears one band under its top bar
(`src/lib/components/start/StartTrail.svelte`): `← GET STARTED · 01 OF 07 ·
ADD A REPOSITORY · TICKS ITSELF WHEN ONE IS ADDED`, with ✕. When the step
ticks, `✓ 01 DONE · A REPOSITORY ADDED`, what's still open, and BACK TO GET
STARTED → in accent. While the trip waits on a step the band asks for the
list every 5 s (`invalidate('tsundoku:start')`), so a phone pairing or a
download ticks it without a reload.

- **A SET UP trip** lasts on its one screen, across its tabs and its own
  redirects. 03's is IMPORT A BACKUP → (c511): the band is on the pick
  screen and on the file's own page, `/import/<id>` (its preview, its
  progress and its result, where the step ticks once the import brings a
  series in: `✓ 03 DONE · A SERIES FOUND`). The upload lands there, so the
  trip lasts across it. IMPORT LOG is not the trip's screen and draws no
  band, but a look at it does not end the trip (`through`).
- **A FIRST READ trip is one band for the whole part**, lasting across the
  search, a source's BROWSE, the preview, the series screen and DOWNLOADS
  (`TRAIL` in `library/start.ts`). The reader shows no band, since it shows
  nothing else, and the trip goes on when it closes. The band moves on as
  each step ticks: `FIRST READ · 05 OF 07 · FIND SOMETHING TO READ`, then `✓
05 DONE · READ ONLINE` / `NOW 06 OF 07 · + ADD TO LIBRARY, BELOW`, then
  `✓ 07 DONE · 10 CHAPTERS QUEUED · FIRST READ DONE` with DOWNLOADS → and
  BACK TO GET STARTED →. A trip keeps which FIRST READ steps were done when
  it began (`before`), so a tick on the way is told from one done long ago.
- **The next control wears a 2px accent ring**: + ADD TO LIBRARY on the
  preview while 06 is next, the DOWNLOAD row (on the preview or the series)
  while 07 is; on a phone or a TV, while the series' DETAILS is folded, its
  DETAILS line (doc/SERIES.md, "DETAILS").
- **On the series just added**, the band takes the place of ADDED TO THE
  LIBRARY: its chapters line ahead of the next step, and the same UNDO.
- **On the phone** the band narrows to `← · 06 OF 07 · ✕`, and BACK → in
  accent once a step ticks.
- It ends with ✕, with the way back, or when its screens are left any other
  way (the sidebar, the library, SETTINGS). Opening those screens on one's
  own never starts one.
- **Kept in the tab's sessionStorage, not the URL**: EXTENSIONS redirects to
  `?tab=repos` after adding a repository, which would drop a parameter, and
  the band with it, at the moment the step ticks.

## Where it departs from the handoffs

- **04 ticks on any phone, tablet or TV that has paired or checked in**,
  not "a second device signed in over Tailscale": which door a device came
  in by isn't recorded. A paired device, or a phone, tablet or TV in
  DEVICES, ticks it ("04, exactly", above).
- **No "Wi-Fi needs a password first" state.** The handoff drew one for an
  install with no password, but Wi-Fi pairing needs none: with no password,
  only a code signs in ([`WIFI.md`](WIFI.md)). Tailscale does need one, and
  its way says so.
- **The done row's meta** counts (`Done · 2 repositories`), without the
  repository's kind: a Mihon or Aniyomi repository's kind isn't kept.
- **02's open body leaves out** `LANGUAGES COME FROM SETTINGS · EN`.
- **02's done link is BROWSE →**, as the first handoff drew it; the FIRST
  READ boards show EXTENSIONS → there.
- **`/start` on the desktop** has a heading the handoffs didn't draw: `Set
up, then a first read.` (and FIRST READ's head once SET UP is through).
- **Every block is closed** (doc/design/README.md, "Close every block", a
  rule written after both handoffs): the steps' rows, the holds tables and
  the rows a step leads on from have all four sides, where the handoffs drew
  rules above and below only. On the phone the list runs edge to edge, and
  the screen's sides close it.
- **No cover squares on the rows** a step leads on from (a source, the
  record, the series): the handoff's are placeholder stripes whose colours
  aren't tokens.
- **The replicas take real numbers**: 06's bar the record's own ▶ CONTINUE
  line, 07's DOWNLOAD row the series' own unread count (NEXT 10 once
  something's on disk). Without a record or a series, the replica goes.

## What it doesn't do yet

- The Aniyomi and LNReader backup rows are drawn dimmed, NOT YET: card c190
  (the owner's call for c438, 2026-11-03: Mihon first).
- 05's search field and source rows are the first day's; a source that never
  answers still lists.
- The phone's narrower 05 body and tick line are CSS swaps of two messages,
  not one.

## Tests

`tests/start-domain.spec.ts` (what ticks a step, done wins, SKIP and what it
takes with it, the parts and folding, which step opens, the FIRST READ band
as each step ticks, the words); `tests/start-db.spec.ts` (the facts: 03
against 06, records, the queue and downloads, hidden series);
`tests/i18n-domain.spec.ts` (the list in Portuguese, 03's import line
included). `tests/start-flow.e2e.ts`
on its own preview with an emptied database: the list in two parts, ASK and
the band, a pairing ticking a step (a row written by hand, on the trip's
band), leaving ending the trip, SKIP and UNDO
taking FIRST READ, the sidebar's and MORE's rows, the first day once
everything is skipped and the folded parts, and FIRST READ end to end (SET UP
done leading to it, the band from the search through a record, ADD and a
queued chapter to BACK TO GET STARTED), and 03's IMPORT A BACKUP → (the
band on `/import`, its tick when an import lands, the done row's import line
and IMPORT LOG → to the entry, c511). `tests/friend-pair-firefox.e2e.ts` (c722) pairs a phone through the real
link on the friend install's Wi-Fi listener and watches 04 tick on the
computer's open `/start` with no reload. Generated from the handoffs:
`tests/start-frame.e2e.ts` (`Start-Checklist.dc.html`, SET UP's 01 open) and
`tests/first-read-frame.e2e.ts` (`FirstRead-List.dc.html`, the parts' heads
and every row), on `/start`.
