# The reading log

`reading_events` is an append-only record of reading: one row per open, page
turn, finish and close, plus one per manual mark read or unread. It exists
**before the features that will read it**: stats, history, tracker sync, and
Kumiko's reading time. Those can all be summarised from a log any number of
ways later, but none of them can be rebuilt from a log that was never written.
Every page read before the log existed is lost to them for good.
Reading time is the first of them built (card c443): see "Who reads it".

## Who writes it

- **`POST /api/reading`** (`src/routes/api/reading/+server.ts`) is the
  reader's one call. It checks the entry is readable, a hidden one only while
  reveal is on, and then, unless incognito is on, calls `recordReading()`. It
  answers `{ saved }` either way ([`PRIVACY.md`](PRIVACY.md)).
- **`recordReading()`** (`src/lib/server/series.ts`) does the write.
  In a single transaction it appends the event and moves the entry's
  `last_position` / `last_opened_at` (and `read_at` on `finish`), so progress
  and the log can never disagree. It refuses an entry that isn't in the named
  series and writes nothing. The reader ([`READER.md`](READER.md)) posts to
  `/api/reading` and nothing else to record progress: open, page (once
  settled), finish, and close by beacon.
- **`markEntries()`** logs `mark_read` / `mark_unread`, but only for entries
  that actually changed state. A manual mark counts as finished, never as time
  spent.

## What a row means

| Column        | Meaning                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at`          | When it happened (ms).                                                                                                                                                                                                                    |
| `kind`        | `open`, `page`, `finish`, `close`, `mark_read`, `mark_unread`.                                                                                                                                                                            |
| `page`        | 0-based page or text position, when the event has one.                                                                                                                                                                                    |
| `duration_ms` | Reading time this event accounts for: the gap since the previous event in the same sitting, **capped by the reader** so a tablet left open overnight isn't eight hours of reading (see "The caps"). For an episode, what actually played. |

Deleting a series deletes its events. Deleting an entry keeps its events with
`entry_id` nulled, so a series' totals survive a re-scan that renumbers files.

## The caps (card c443)

Each reader times its events with a clock (`src/lib/reader/reader.ts`), and the
cap is the longest a page can plausibly hold someone, so it is the **medium's**,
never a kind's name. Each reader is one medium and chooses its own:
`TextReader.svelte` passes `IDLE_CAPS.text`, `ImageReader.svelte` takes
`ProgressClock`'s default.

| Medium | Cap               | Why                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pages  | 2 minutes         | Since the log began (`IDLE_CAP_MS`). A manga page or a strip's screen is read in seconds.                                                                                                                                                                                                                                                                                                          |
| text   | 5 minutes         | A page of prose at the default size holds **352 words** on a tablet held upright (size 20) and **391** held sideways (size 19, two columns), counted on screen in the text reader at 800x1280 and 1280x800 (176 on a phone). At **80 words a minute**, a slow and careful pace well under the ~260 of adult fiction reading, 391 words is 4.9 minutes. Two minutes cut a slow reader's page short. |
| video  | none: what played | `WatchClock` counts a `timeupdate` step only when the position moved forward about as far as the wall clock did. Paused, buffering (`waiting`, `stalled`), a seek either way, and a hidden page (unless the picture is in a floating window) add nothing. Faster playback counts the time spent. A lap is capped at 60 s, four of the player's 15 s heartbeats.                                    |

What counts as watching is one pure question, `isWatching` beside the clock
(c481): playing, not seeking, and the page visible or the picture in a floating
window. Its unit cases are in `tests/reader-domain.spec.ts`. The player's own
wiring is covered by `tests/browse-player-watching.e2e.ts`, which plays the
browse world's 8 s clip on a database of its own. It checks that a pause posts
nothing, and that a page told it is hidden posts 0 although the picture plays.

Rows written before c443 stay as they are: a novel page that took four minutes
then says two.

## Estimated rows (rung 65)

Until c443 the player sent no `durationMs`, so every anime event carried 0 (0 of
854 on the live library, 2026-11-03). Rung 65 (`src/lib/server/db.ts`) gives
those rows an **estimate**: an episode's `page` is its position in seconds, sent
every 15 s while playing, so where a step's position moved forward by what the
clock did, within 2 s, the episode played through it, and the step's time is
the position's move. A pause or a stall moves the clock and not the position, a
seek moves the position more than the clock: both stay 0, so the estimate
counts only what it can vouch for. On a copy of the live library 685 of 769
`page` steps matched (15 s each, the rest were seeks and pauses), and the rung
filled 704 rows with **2.9 hours**. Anime rows with time from before the rung
are estimates; rows from c443 on are measured.

## Who reads it

**Reading time** is one summary, `readingTime()` in
`src/lib/server/reading-time.ts`, by series, kind, day or series-and-day. Every
screen that shows a time asks it, so none can disagree about what counts:

- **The series screen** says `READ 12 H 40` (`WATCHED` for video, the
  registry's `unit.done`) beside the read progress ([`SERIES.md`](SERIES.md)).
- **HISTORY** says each row's time under its clock, and a total at the top
  with each kind's, `SINCE` its first day ([`HISTORY.md`](HISTORY.md)).
- **Later**: c35's reading stats for Kumiko's metrics, and the graphs (a new
  screen, so a design brief first), read the same function.

It counts `open`, `page`, `finish` and `close` only; it applies the reveal
filter in SQL at every door (a hidden series' time is in no total while reveal
is off); and it ignores any event dated before **2015-01-01**
(`FIRST_PLAUSIBLE_DAY`: the oldest history tsundoku can import is a
Mihon/Tachiyomi backup, and Tachiyomi's first release was in 2015). One live row
is dated `at = 0`, which would otherwise be a day in 1970. HISTORY's days use
the same floor.

The numbers on 2026-11-03, for scale: manhwa 207.6 h, manga 61.1 h, doujin
20.2 h, novel 1.1 h, anime 0 h before rung 65 and 2.9 h after. Novels are mostly
history that was never recorded: their events start 2026-09-23, when
`/api/reading` arrived, and no import brings novel reading in. That is why a
kind's total says `SINCE`.

## Rules for what reads it later

- **Incognito reading must never reach `recordReading()`.** It isn't "write,
  then hide": the row mustn't exist. That's the whole promise of incognito,
  and `/api/reading` keeps it.
- **History** ([`HISTORY.md`](HISTORY.md)) reads `open`, `page`, `finish` and
  `close`, never the marks.
- **Hidden series are logged like any other.** Stats and history then apply the
  same reveal filter as everything else, so a hidden series' reading counts
  only while reveal is on.
- Series and entries also carry `source_url` and entries a `cover_phash`,
  captured at import for tracker matching and duplicate detection. The
  importers fill them. Nothing reads them yet.
