# IMPORT A BACKUP

Bringing a library in from a phone's app by uploading its backup in the
browser (card c438, slices 1 and 4 of c190). One page, `/import`, behind every
door: it reads the file before writing anything, says what it holds, and on
IMPORT brings it in through the same writer a scan uses. The IMPORT LOG keeps
every import and every scan.

Built from the handoff `doc/handoffs/import-backup/` (`[finished]`, its calls in
`Main.dc.html`) and the brief `doc/briefs/IMPORT-BACKUP.md`. **Mihon first**
(the owner's decision, 2026-11-03): Aniyomi and LNReader are drawn as NOT YET
until their importers land (c190).

How a Mihon backup becomes series, chapters, reading and shelves is
[`IMPORT-MIHON.md`](IMPORT-MIHON.md); this document is the page in front of
it, the upload and the log.

## The screens

| Screen      | Route           | Board                                                  |
| ----------- | --------------- | ------------------------------------------------------ |
| Pick a file | `/import`       | Import-Pick, Import-File-States A-C, Import-Phone-Pick |
| Preview     | `/import/<id>`  | Import-Preview, Import-Preview-States, File-States D-F |
| Progress    | `/import/<id>`  | Import-Progress, File-States E                         |
| Result      | `/import/<id>`  | Import-Result, Import-Phone-Result                     |
| IMPORT LOG  | `/import/log`   | Import-Log                                             |
| The doors   | (other screens) | Import-Doors                                           |

`/import/<id>` follows the row's state: a file read and waiting shows its
preview; one running or waiting its turn shows its progress, asking the server
again every second; one done (or stopped) shows its result. A file that was
refused shows why, with CHOOSE ANOTHER.

The phone's boards are the same pages below 600 px wide (`.phone`'s rules in
the handoff's `im.css`, as a media query): the drop box becomes one wide
CHOOSE THE BACKUP FILE button that opens the phone's own picker, the numbers
go two across, and the confirm bar stacks.

## The doors

- **GET STARTED, step 03** (`src/lib/components/start/StartList.svelte`; on
  the empty library and on `/start`): Mihon backup with **IMPORT A BACKUP →**,
  which starts GET STARTED's trip (← GET STARTED · 03 OF 07, c511;
  [`ONBOARDING.md`](ONBOARDING.md), "The way back"), Aniyomi and LNReader dimmed with **NOT YET**. Under them, FILES INSTEAD: the
  library folder and **START SCAN**, for EPUBs and downloaded chapters. The
  step ticks when an import or a scan brings in a series (its rule is
  unchanged: any series in the library). Done by an import, its row on
  `/start` names it, `Done · Mihon backup · 382 series`, with IMPORT LOG → to
  its entry (c511, Import-Doors B).
- **SETTINGS › 05 — LIBRARY › IMPORT A BACKUP**: when the last import came in
  (`LAST: MIHON BACKUP · 2 NOV · 382 SERIES`, or `NO IMPORT YET`), CHOOSE A
  FILE →, and IMPORT LOG → in the scope cell. On a TV the row says _From the
  computer or a phone_ with no button: **the TV never imports** (a CSS rule on
  the TV's media query, as every device rule is). **The server refuses a TV
  too** (c511): the TV app's user agent (`TsundokuTV/<version>`, `isTvApp`,
  which pairing and device sync already read) gets `THE TV NEVER IMPORTS ·
CHOOSE THE FILE ON THE COMPUTER OR A PHONE · NOTHING CHANGED`, drawn on
  `/import` instead of the pick screen and on `/import/<id>` before its row
  is read; the upload answers 403 with that sentence before a byte is kept,
  and IMPORT answers 403 and starts nothing (`src/lib/server/import/tv.ts`).
  The phone app (`TsundokuApp/`, [`PHONE-APP.md`](PHONE-APP.md)) and every
  browser import as before. A TV's own browser without the app sends no such
  signal and is not refused.
- **IMPORT LOG**: the desktop sidebar's row is a link (no longer disabled),
  counting a running import or scan in accent (`42%`). On a tablet or phone it
  is MORE's last row, with when the last backup came in (`LAST 2 NOV`).

## The upload

The browser sends the file to `/import/upload` **in pieces of 256 KB**
(`CHUNK_BYTES`), each a plain POST of raw bytes with the file's name, size,
offset and where it was chosen (`desktop`, `tablet`, `phone`) in the query.
The first piece opens the upload and is answered with a token; each next one
must start where the last ended, or the upload is dropped with THE UPLOAD WAS
INTERRUPTED. CANCEL deletes what arrived. The last piece is read at once and
answered with what the file is.

**Why pieces, not one multipart body.** The release runs adapter-node through
`scripts/serve.ts`, and adapter-node refuses a body over `BODY_SIZE_LIMIT`
(512 KB unless set) with a bare `413 Payload Too Large`. Measured on
2026-11-04 against `scripts/serve.ts` (local mode, this branch's build): one
5 MB body and one 600 KB body were both refused with 413; a 4.1 MB `.tachibk`
in 16 pieces arrived whole and imported. `vite preview`, which the e2e suite
serves, enforces no such limit, so a spec that only used it would have passed
while the release refused every real backup. Pieces work under any server the
app runs on, need no setting in the launcher (`ops/release/launcher/plan.ts`)
or in `scripts/serve.ts`, and give the pick screen its progress and CANCEL for
free. `tests/import-flow.e2e.ts` proves both halves through `scripts/serve.ts`
itself.

**The size limit is the app's own: 100 MB** (`MAX_BACKUP_BYTES`). The owner's
Mihon library of 373 series makes a backup well under 1 MB; the board's is
2.4 MB. A file past it is refused on its first piece, before a byte is kept,
with a sentence (`HUGE.TACHIBK · 100.0 MB · OVER THE 100 MB A BACKUP MAY BE ·
NOTHING CHANGED`), never a 413 page.

**Where the file is kept: the data folder's import area**, `TSUNDOKU_HOME/
imports` (`importArea()` in `src/lib/server/data-dirs.ts`; `IMPORT_DIR` wins),
**never the library**, so a backup is never scanned as a book and never moves
with the library. Pieces arrive as `upload-<token>.part`; a file it reads is
renamed `<id>-<name>` and kept, because the log names it. A refused file is
deleted at once (its row stays, for the log). A preview nobody imported within
a day is cleared, file and row, at the next upload, as are pieces a restart
left behind.

## Reading the file

Nothing is written while a file is read. `readBackupFile`
(`src/lib/server/import/backup.ts`) answers, in this order:

| The file                             | The answer                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| empty                                | NOT A BACKUP · AN EMPTY FILE                                                  |
| a zip (`PK`)                         | NOT A BACKUP · A ZIP · LNREADER BACKUPS ARE NOT READ YET                      |
| not gzipped                          | NOT A MIHON BACKUP: A .tachibk IS GZIPPED, THIS ISN'T                         |
| gzip that does not end               | A .tachibk THAT ISN'T WHOLE (CUT OFF IN THE COPY)                             |
| gzip that unpacks past 1000 MB       | IT UNPACKS TO MORE THAN THE 1000 MB A BACKUP MAY HOLD                         |
| gzip whose contents are not protobuf | ITS CONTENTS DON'T READ AS A BACKUP                                           |
| Aniyomi's (see below)                | AN ANIYOMI BACKUP · ANIYOMI IS NOT READ YET                                   |
| no manga and no categories           | NO LIBRARY IN IT: NOT A MIHON BACKUP                                          |
| nothing in the app's library         | NOTHING TO BRING IN · MIHON BACKUP · 0 SERIES IN ITS LIBRARY · N ONLY BROWSED |
| a Mihon backup                       | its preview                                                                   |

Every refusal ends NOTHING CHANGED and is shown on the pick screen with a 3px
ink rule, as a failed row is everywhere.

The unpacked size is capped (`MAX_RAW_BYTES`, ten times the upload's 100 MB):
the upload is foreign input, and a small gzip of zeros would otherwise inflate
to gigabytes in the server's memory on every preview.

### Which app

Mihon and Aniyomi both write `.tachibk`. **Measured in the decoder**
(`src/lib/import/mihon-backup.ts`): `decodeBackup` reads only the top-level
fields 1 (manga), 2 (categories) and 101 (sources), so an Aniyomi backup would
read as Mihon with its anime silently dropped. Aniyomi's `Backup` adds anime
(3), anime categories (4) and anime sources (102, 103); Mihon's schema has
none of them (its 100 is broken sources, 104-106 preferences and
repositories). **A file with any of 3, 4, 102 or 103 at its top level is
Aniyomi's**, and is refused with a sentence rather than read as Mihon. This
was not measured against a real Aniyomi backup (the owner has none yet): the
field numbers are Aniyomi's published schema. An Aniyomi backup with no anime
in it at all carries none of those fields and reads as Mihon, which is what
its manga are.

### Damaged series

`readBackupLenient` decodes the file one series at a time: a series whose
bytes don't decode is refused by its title (or as untitled when even that is
unreadable), and the rest come in. The preview's 04 — LEFT OUT and the
result's 02 list them, REFUSED.

## The preview

`previewBackup` (`src/lib/import/backup-preview.ts`, pure) from the file's
plan (`planMihon`, as an import plans it) and the library's facts
(`libraryFacts`). **It counts the file, hidden series included**: the file is
in the owner's hand, and nothing on the preview says a series would be hidden.

- **01 — WHAT IT HOLDS**: series and sources; up to three kinds, then WITH
  READING with the chapters read. Below, how many are already here (by origin
  key) and SEE ALL n →, which opens the list in place: a search, a tab per
  kind, 150 rows at a time (150 FURTHER ↓), each marked ALREADY HERE or NO
  SOURCE. For checking, not choosing: no per-series checkboxes.
- **The same library** (Import-Preview-States C), shown when an earlier import
  was the same library: `THE SAME MIHON LIBRARY CAME IN ON 28 OCT`, with NEW,
  ALREADY HERE, WITH NEWER READING (here, with chapters the file has read that
  are unread here) and GONE FROM THE APP · STAY HERE.
- **02 — SOURCES IT NEEDS**: each source the file names that no installed
  extension provides, with its series. FOUND IN <repository> when an added
  repository lists it, with **INSTALL** and INSTALL ALL FOUND; otherwise
  NO REPOSITORY YOU'VE ADDED LISTS IT with ADD A REPOSITORY. A missing source
  never blocks IMPORT.
- **03 — CATEGORIES**: every category a chip, ticked, with its count.
  ADDS TO YOUR SHELF when a shelf of that name exists, RATES 8 for the
  importer's rating names (Amazing 10, Good 8, Okay 6). **Unticked**, a
  category is no shelf and no rating; its series still come in, and a "+"
  category **still hides** (`leftOutEffect`, `mihon-plan.ts`): unticking is a
  choice about shelves, never a way to show what a category hides. Its
  `mihon:` tag stays, as a record of where the series came from.
- **04 — LEFT OUT**: browsed only (never in the app's library), the app's
  local folder (its files stayed on the phone, c191), and damaged series.
- **The confirm bar**: what it would bring, CANCEL, and IMPORT n SERIES →.
  While another job runs it says so; IMPORT still queues.

### Installing a missing source

INSTALL posts to EXTENSIONS' own `install` action
(`/browse/extensions?/install`, the form action BROWSE › EXTENSIONS posts), so
installing follows EXTENSIONS' rules unchanged: a repository's signature is
checked, and an untrusted one installs nothing. The row then says UNTRUSTED
and offers only **REVIEW…**, which opens EXTENSIONS. Nothing installs silently.

### The same library

A backup carries no id of its own, so **a library is what it holds**: the
newest earlier finished import of the same app is the same library when at
least half of the series it brought are in this file (`sameLibraryAs`). A
library that grew keeps all of the old one's series; a friend's other phone or
someone else's backup shares few. A different library is never called the
same (`tests/import-upload-db.spec.ts`). What is already here, and what the earlier import
brought, are read through reveal (`libraryFacts`): with it off, a hidden
series counts as neither ALREADY HERE nor GONE, so the preview never says one
exists.

## IMPORT

`startBackupImport` runs the stored file as **a scan job of one step**
(`runQueued`, `src/lib/server/import/index.ts`), through `writeSeries`, the
writer every importer uses, into the `Mihon` root at `<library>/Mihon`
(whether that folder exists or not), so a backup later dropped in
`Mihon/autobackup` finds these series by their keys.

- **One import or scan at a time.** An import chosen while a scan or another
  import runs waits (`waiting`), and says so on its page, on the confirm bar
  and in the log; it starts when the running one ends. A scan asked for while
  a backup's import runs or waits (START SCAN, RESCAN, `/api/scan`, the search
  `scan` command, a download's import) **waits its turn too**, then reads the
  library folder in a job of its own: START SCAN and RESCAN say `WAITING · THE
SCAN STARTS WHEN THE BACKUP’S IMPORT ENDS` (`SCAN_WAITS`), and `/api/scan`
  answers `waiting: true`. **RESCAN's line in the sidebar is the queue's own
  state** (c512): the layout's load hands it over (`scanWaitsLine`, so
  `scanWaits` on the layout's data) while a scan someone asked for is queued
  behind a backup's import (`scanQueued`: the queue is set when the scan
  queues and cleared just before it starts), the sidebar asks that load again
  every two seconds while it is (`invalidate('tsundoku:scan')`), and the line
  goes once the scan has started. A backup's import that nobody asked a scan
  of draws no line: `scanWaits()`, true for that import's whole run, answers
  only whether a scan asked for _now_ would wait (`startScan`'s `waiting`),
  and the sidebar does not read it (wave 23, round 2). Until wave 23 it was the action's answer, kept until the next
  press, so it stayed as a `role=status` line on every page after the scan
  had run. A refusal (nothing to import) is still the action's answer. Only a running _scan_ is joined, by a second scan;
  a second scan asked for while one waits joins the waiting one. `runImport`
  keeps which kind of job runs (`runningScan`) for this.
- **An import whose process died is stopped.** Only this process's promise
  moves a row on from `running` or `waiting`, and the queue a `waiting` row
  waits in is in memory. So `backup.ts` keeps the ids it has queued or is
  running, and a row in either state that is not among them (left by a
  restart or a crash) is closed as `failed` with its `finished_at` wherever
  rows are read (`importRow`, `importLog`, `liveImport`; `closeDeadImports`):
  its page says STOPPED with what it wrote, and the log no longer pins it.
  Never from `run()`'s `closeDeadJobs`, where a second import is rightly
  waiting while the first one's job opens. Its `scan_jobs` row is closed by
  `closeDeadJobs` as any dead job's is.
- **An IMPORT that throws before its run**
  (c512: everything from the row's `running` to the queue is synchronous,
  and `libraryFacts` parses every `engine_listings` row) fails where it
  stands: out of the live set, `failed` with its `finished_at`, and the
  action answers `COULD_NOT_START` (`THE LIBRARY’S OWN RECORDS COULD NOT BE
READ · SEE THE SERVER’S LOG`), drawn as `IT DID NOT START · …`. It used to
  stay `running` and live, so its page polled until a restart.
- **A second backup merges** by the importer's rescan rule
  ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Rescanning"): it adds and updates,
  removes nothing, read state only moves forward, and what the owner set here
  is left alone. Verified from a library that came in from a first backup, in
  `tests/import-upload-db.spec.ts`: rating, FAV, a shelf, hidden and direction
  set through the app's own functions, and title and kind by hand (no door
  edits those, see "Premises" below), all survive a second import; a series
  gone from the app stays.
- **A source's ADDED HIDDEN applies** to the series it creates, as at a
  scan: a new series from a source with the switch on arrives hidden, and
  one already here is left as it is (card c503; [`BROWSE.md`](BROWSE.md),
  "ADDED HIDDEN at the importer").
- **The library's band** follows it: `IMPORTING · MIHON BACKUP`,
  `162 OF 384 SERIES`, the count of arrivals on NEW. A backup's job counts
  **series written** in `scan_jobs.bytes_done`/`bytes_total` (its label,
  MIHON BACKUP, says so; `Source.counts`), because the file is read whole
  before anything is written and bytes would sit at 0 until the end.
- Covers, catalogue links, the owner's lists and Ranobe follow an import as
  they follow START SCAN (`afterImport`). `TSUNDOKU_IMPORT_COVERS=0` turns
  that off, for a spec that must not reach the internet.

## The log

`/import/log`: every import of a file and every scan, newest first, an import
or scan running or waiting at the top with its bar; THIS WEEK, then EARLIER.
An entry opens in place: the file, its size and where it came from, the
extensions it lacked, the shelves it made and the categories left out, the
series refused. A refused file is listed (NOT READ). A preview nobody
imported is not an import and is not listed. `?open=backup:<id>` (or
`scan:<id>`) opens that entry on arrival: GET STARTED's 03, done by an
import, links its entry so (c511). `?job=<scan job id>` opens the entry of
that job, a scan's or a backup's, which is all the library's band knows of
an import (c511's third part, the band's LOG →, is `works`' to draw).

**WORKS: what a fold dropped** (c570). When an import or a scan folds a
download folder's series into the series a backup names, and both were
parts of different Works, the folder's Work loses that part
([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Both exist"). The entry's head counts
them (`· 1 WORK DROPPED`) and, open, lists each under WORKS as the summary
prints it: `DROPPED FROM <WORK> · <survivor's title>`, with `· THE WORK ENDED`
when it was left with one series. The line opens the Work while that Work
still exists: the job keeps its id **with its `created_at`**, because
`works.id` is reused once the newest Work ends, and an id alone would open
whichever Work took it. **Hidden means hidden**: with reveal off, a line is
drawn only when both hold. Its survivor is visible now: a line whose
survivor is hidden, has since been deleted, or whose id another series took
(kept with its `added_at` for that reason) is not drawn, since nothing kept
says whether it was hidden. And when the dropped Work still exists (by its
id **and** `created_at`, and it did not end at the fold), it has a visible
part now. The second condition exists because a Work can be hidden after
its fold: the line prints the Work's name, and a Work that kept three or
more parts can be hidden with HIDE ALL later while the survivor stays
shown. A Work that ended, or whose id another Work now holds, adds no
condition: the survivor's rule alone decides. With reveal on,
every line is drawn. A run that throws part-way still records the folds it
made (each series is its own transaction); a job a dead process left lists
none.

**Rung 66** (`src/lib/server/db.ts`) keeps it:

- `imports`: one row per file chosen: when, which app, its name, size, when
  Mihon made it (from its name), where it is stored, where it was chosen,
  its state (`read`, `refused`, `waiting`, `running`, `done`, `failed`), the
  refusal, its job, series total and done, and `outcome` (JSON: categories
  left out, shelves, how many rated, browsed, local, refused titles, the
  sources it lacked).
- `import_series`: which series it brought, and whether each was new or
  merged. **Counts are read through `series` and its root, never stored**, so
  they follow reveal (a hidden series is not counted with reveal off) and a
  series deleted since stops counting. A series deleted takes its row with it;
  a job forgotten leaves the import unlinked.

A scan stays a `scan_jobs` row alone; the log reads both. **Rung 71** adds
`scan_jobs.dropped` (JSON, `'[]'` by default): the Works its folds dropped,
written as the job finishes (`finishJob`). Every job stored before the rung
has `'[]'`, which is right: nothing recorded them, and they cannot be read
back from anything kept.

## Where it departs from the handoff

- **Aniyomi and LNReader are NOT YET** everywhere the handoff draws them live
  (GET STARTED 03, the pick screen's where-each-app rows): the owner's call,
  2026-11-03. Their numbers (Import-Preview-States E) and their download
  folders are not built.
- **SKIP per source, and its UNDO, are not drawn** (Import-Preview-States A):
  skipping changes nothing about what comes in (a source's series always come
  in), so the row says SKIP: NO NEW CHAPTERS, as the main board does, and
  INSTALL is the one choice.
- **ADD A REPOSITORY opens EXTENSIONS' repositories tab**, not a paste field in
  the row (Import-Preview-States B): adding a repository is `browse`'s
  `addRepo` action, which redirects to its own page; doing it in place needs
  that action to answer without leaving, which is not this slot's file.
- **A missing source's row has no icon cell**: the board's striped squares are
  placeholders for an extension's icon, which a source the library has no
  extension for has not got.
- **The progress board's steps** are three rows (read, writing, reading
  history and shelves with each series), not five with separate counts: the
  writer does history, shelves and ratings per series, not as later steps.
- **The result's merged row** says READING ONLY MOVED FORWARD without "on 9":
  how many series' reading moved is not measured by the writer.
- **The phone's back cell** on the pick screen goes to the library, not to
  SETTINGS (the board's "Back to settings"): the page has several doors.
- **The trail** reads `03 OF 07`, not the board's "03 OF 04": GET STARTED
  has seven steps since FIRST READ (c209). It is drawn on `/import` and
  `/import/<id>` (c511).
- **STEP 03 DONE BY AN IMPORT** (Import-Doors B) is drawn on `/start` only:
  the empty library's list is `src/routes/+page.svelte`'s, which does not
  hand the list the last import yet (c511; `doc/handoff-notes/import.md`,
  wave 26, Gaps, has the patch). Its link opens the import's entry in the
  log, as the board's note asks, through `?open=backup:<id>`.

## Premises

- **No door edits a series' title or kind** (the handoff lists both among "what
  you changed here"). `rg` over `src/lib/server` finds no `UPDATE series SET
title` or `kind` outside migrations and MOVE's key rewrite. The writer
  never touches either on a series it finds again, which the spec checks by
  setting them by hand.

## What it does not do yet

- Aniyomi and LNReader backups (c190's importers).
- ADD A REPOSITORY in place, and the ADD AND INSTALL in one go.
- REPLACE: by design there is none (Main.dc.html, Q1).
- The library band's LOG → link, and SEE LOG opening the band's own entry
  (c511's third part: the band and `Banner` are not this slot's; the log
  opens an entry by `?open=backup:<id>` or `?open=scan:<id>` for them, and
  the patch is in `doc/handoff-notes/import.md`, wave 26, Gaps).
- Choosing which series come in: by design the list is for checking.
