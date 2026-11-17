# History

A dated log of what was read, reached from CONTINUE. It is CONTINUE going
further back: CONTINUE's right label reads **N OPEN · HISTORY →**, and on
desktop HISTORY is also a sidebar row above IMPORT LOG.

Route: `/history`, with `?before=YYYY-MM-DD&n=N` for the page after.

## One row per series per day

A manhwa binge is twenty chapters in one sitting, so a row per chapter would
bury everything else. Each row is one series on one day. It shows:

- the **range** read that day, from the lowest entry opened to the highest
  ("CH. 380 → 388", or "BOOK 2 → 3" in a series of books);
- **how far** the highest one got: "P. 12" in a range, "P. 9 OF 31" on a
  single chapter, a percentage for a novel;
- "UP TO DATE" when the last entry was finished, or "FINISHED" instead when
  the series is complete or is a single book;
- the **time** of the last event that day, and under it the **time read**
  that day ("40 MIN", "1 H 56"), absent where the log holds none.

`historyMeta()` in `src/lib/library/history.ts` writes that line, and
`tests/history-domain.spec.ts` holds its examples. On a phone the page and UP
TO DATE drop off a range. The server renders both strings, and CSS picks one,
so the first paint is already right.

Only **reading** counts: `open`, `page`, `finish` and `close` events. MARK
READ and MARK UNREAD are bookkeeping, so a chapter marked read without being
opened isn't in history.

## Days and times

A day is the **workstation's** local calendar day. SQLite groups by it with
`date(at / 1000, 'unixepoch', 'localtime')`, and the page is rendered on the
server in the same zone, so a row never lands on one day and shows another
day's time. If a device and the workstation disagree about the time zone, the
workstation wins.

Days are numbered from the top: "01 — TODAY" and "02 — YESTERDAY" carry the date
on the right, and older days are named ("03 — MON 21 SEP"). An older day's
right side shows the year only where the year changes, so a long history says
"2025" once, at the first day of 2025.

## Time read

The first page opens with a total: `READ 289 H 30` and `SINCE 12 MAY 2023`, the
first day the viewer may see that carried **time**. Under it, each kind's
total, largest first, and `· SINCE <day>` on a kind whose first timed day is
later than the total's (novels: their reading is logged only since
`/api/reading` exists), so a kind's figure is never read as all of that kind's
reading.

**Every SINCE is a first timed day**: each kind's is its own first day with
`duration_ms > 0`, and the total's is the earliest of those. A day logged with
no time on it (an episode watched before the player sent its time, where
migration 65 could not estimate it; a novel's untimed rows) dates nothing, so the total never reads an early SINCE over hours that
only start later. A kind whose reading carried no time at all has no line and
no SINCE.

The words are made in `src/routes/history/total.ts` (`historyTotal`,
`tests/history-domain.spec.ts`), the days in `readingTime()`
(`tests/reading-time-db.spec.ts`, "SINCE is each kind's own first timed
day"). Both come from `readingTime()` ([`READING-LOG.md`](READING-LOG.md),
"Who reads it"), under the reveal filter: a hidden series' time is in no row
and no total while reveal is off. A REMOVEd row's time still counts in the
totals: removing a row hides the row, not the reading.

**No 1970.** An event dated before `FIRST_PLAUSIBLE_DAY`
(`src/lib/server/reading-time.ts`, the first day of 2015) is a clock that was
never set (a row with `at = 0` exists in real logs): HISTORY lists no such
day, and no total counts it.

## Removing a row

A long press on a row (450ms, or a right-click) shows the pressed state:
REMOVE and ✕, with "REMOVES THIS ROW · CH. 22 STAYS". REMOVE writes
`(series_id, day)` to `history_removed`, and a band offers UNDO. **Only the
row goes.** The log, the progress and CONTINUE are untouched. Progress is
changed on the series screen with MARK UNREAD.

`history_removed` cascades with its series. So when grouping books deletes a
singleton series, a row removed from its history comes back under the new
series. That's rare, harmless, and cheaper than re-homing removals.

## What it shows and doesn't

- **A browsing record** (something opened from a source without ADD,
  [`READING-ONLINE.md`](READING-ONLINE.md)) has rows like any series, said
  `NOT IN LIBRARY` after its kind. Its row opens its source's preview, where
  ADD is.
- **Hidden means hidden.** While reveal is off, a hidden series has no rows.
- **OFF HISTORY** (a source's own switch, [`BROWSE.md`](BROWSE.md), "A
  source's own switches"): a series from a source with the switch on has no
  rows, inside reveal or not, and its time is not in the total
  (`historyTotals`, which sums `readingTime('series')` over every other
  series, so what counts as reading stays one rule). The switch filters in
  SQL (`sourceFlagSql`). It hides, it does not stop: the reading is still
  logged, so progress, CONTINUE and the series screen's own time are
  unchanged, and **tracking sends as before** (`afterReading` and
  `queueProgress` read the entries' progress, which the switch never
  touches; `tests/source-flags-db.spec.ts` measures the log and the
  progress). Turned off, the rows come back.
- **Incognito reading isn't there** because it was never written
  ([`PRIVACY.md`](PRIVACY.md)). Nothing is filtered out.
- The seed data writes a few days of past reading, including one same-day
  binge, so the screen has something to show on a fresh database.

## Paging and the empty state

The page loads **60 days at a time**, with an EARLIER → row at the end. There
is no month rail for scrubbing through hundreds of days; if one is added it
would reuse the series screen's scrub rail.

The empty state sits in the upper half of the screen (the empty block and the
list share the height), not centred on the page.

## Speed

An event's day, in the workstation's time, is stored on the event (`day`,
migration 13), filled by a trigger when it's written. Working it out with
`date(at, 'localtime')` several times per event on every request took the
screen to 306 ms over 19,000 events imported from Mihon; the stored day takes
it to 5 ms. The day an event belongs to is decided once, in the time zone the
workstation had when it was written, which is also when it was read.
