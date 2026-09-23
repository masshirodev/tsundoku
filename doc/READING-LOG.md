# The reading log

`reading_events` is an append-only record of reading: one row per open, page
turn, finish and close, plus one per manual mark read or unread. It exists
**before the features that will read it**: stats, history, tracker sync, and
Kumiko's reading time. Those can all be summarised from a log any number of
ways later, but none of them can be rebuilt from a log that was never written.
Every page read before the log existed is lost to them for good.

## Who writes it

- **`recordReading()`** (`src/lib/server/series.ts`) is the reader's one call.
  In a single transaction it appends the event and moves the entry's
  `last_position` / `last_opened_at` (and `read_at` on `finish`), so progress
  and the log can never disagree. It refuses an entry that isn't in the named
  series and writes nothing. The reader doesn't exist yet. **When it's built,
  it calls this and nothing else to record progress.**
- **`markEntries()`** logs `mark_read` / `mark_unread`, but only for entries
  that actually changed state. A manual mark counts as finished, never as time
  spent.

## What a row means

| Column        | Meaning                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at`          | When it happened (ms).                                                                                                                                                             |
| `kind`        | `open`, `page`, `finish`, `close`, `mark_read`, `mark_unread`.                                                                                                                     |
| `page`        | 0-based page or text position, when the event has one.                                                                                                                             |
| `duration_ms` | Reading time this event accounts for: the gap since the previous event in the same sitting, **capped by the reader** so a tablet left open overnight isn't eight hours of reading. |

Deleting a series deletes its events. Deleting an entry keeps its events with
`entry_id` nulled, so a series' totals survive a re-scan that renumbers files.

## Rules for what reads it later

- **Incognito reading must never reach `recordReading()`.** It isn't "write,
  then hide": the row mustn't exist. That's the whole promise of incognito.
- **Hidden series are logged like any other.** Stats and history then apply the
  same reveal filter as everything else, so a hidden series' reading counts
  only while reveal is on.
- Series and entries also carry `source_url` and entries a `cover_phash`,
  captured at import for tracker matching and duplicate detection. The
  importers fill them. Nothing reads them yet.
