# Logs, and a report to send

What a friend's install writes down, and how it reaches the owner when
something breaks (card c193; the owner, 2026-10-30: "now that we are
distributing to ppl, adding logs would be nice"). Decided with the owner: a
file the friend saves and sends is enough, nothing is sent by itself, and the
row uses Settings' existing idiom.

## The logs

`logs/` in the data folder ([`DISTRIBUTION.md`](DISTRIBUTION.md), "One data
directory"): `tsundoku.log` (the app), `engine.log`, `flaresolverr.log`.
The launcher writes them (`ops/release/launcher/log.ts`):

- **Every line stamped**: `2026-10-30T18:03:23.487Z INFO  ...`. A child's
  output is INFO, its errors ERROR, the launcher's own `--- starting` and
  `--- stopped (code)` lines say when each run began and ended.
- **Rotated**: before a file passes 5 MB it becomes `.log.1`, the old `.1`
  becomes `.2`, and so on; four old ones are kept. At most 25 MB a log.
- **Written as it comes**, synchronously: a line is on disk before a crash
  can lose it. A few lines a second at most.

The app writes to its log, not to the launcher's window: a Windows console in
QuickEdit selection freezes whatever writes to it ([`RELEASE.md`](RELEASE.md),
"The launcher"). If the app stops by itself, the window shows the end of its
log, or, started from the tray, the tray's menu offers to open it.

Started from the tray ([`TRAY.md`](TRAY.md), "Logs"), two more:
`launcher.log`, the launcher's own lines, which a hidden window can't show,
and `tray.log`, the tray's, in the default data folder.

The workstation doesn't run the launcher: its logs are the journal
(`journalctl --user -u tsundoku`, [`SERVING.md`](SERVING.md)).

## What the app writes

The app's own lines go through `console`, so the launcher's rule stamps them
by stream: `console.log` is INFO, `console.error` is ERROR.

- **Skip marks** (c299): `tsundoku: skip-marks: …`, INFO for a season job and
  each episode outcome (its file or stream, opening and ending found or not,
  a negative kept), and `WARN` (on stderr, so the log calls it ERROR) for a
  step that failed, naming the episode and the server. One line answers "why
  no skip on this episode".
- **Extensions** (c983): `tsundoku: extensions: WARN <package> refused: …` for
  every refused install, update (one line each in UPDATE ALL) and repository
  add, with the URL and what it answered, or for an APK not signed by its
  repository's key, the keys it was signed with beside the expected one. The
  band on EXTENSIONS is gone once dismissed; this is what a friend's REPORT
  shows instead ([`BROWSE.md`](BROWSE.md), "Extensions and repositories").
- **Fingerprinting without chromaprint** (c299): on a build whose ffmpeg has
  no chromaprint muxer and no `fpcalc` to fall back to, said once per run,
  naming the chromaprint package and `FPCALC`, so a friend's install can tell
  why no fingerprint arrives. A release bundle's own ffmpeg has the muxer, so
  it never writes this.

## SAVE A REPORT

SETTINGS › 05 — LIBRARY › REPORT › SAVE downloads `tsundoku-report-<date>.txt`
(`/api/report`, `src/lib/server/report.ts`): the version, the system, how it
serves and signs in, Wi-Fi, updates, whether the engine answers and whether
FlareSolverr is installed, then the last 300 lines of each log. The friend
sends it however they like.

**Hidden means hidden, most of all in a file that leaves the house.** The logs
aren't trusted to be clean: the whole report goes through `scrub`
(`src/lib/server/report-scrub.ts`) on the way out.

- Tokens this install knows (`TSUNDOKU_TOKEN`, `ENGINE_TOKEN`), session and
  pairing cookies, pairing links, bearer tokens: `[secret]`, `/pair/[code]`.
- Every hidden series' title and folder (the app's own `HIDDEN_SQL`) and every
  hidden root's folder: `[hidden]`, case-blind, longest first.
- The data folder and the user's home: `<data>`, `<user>`, with either slash.

Signed in only; never cached. A phone over Wi-Fi saves its own copy, of the
computer's logs.

## Tests

`tests/launcher-log.spec.ts` (stamping, half lines, rotation),
`tests/report.spec.ts` (the scrubbing), and `tests/friend-report.e2e.ts`: a
log carrying a hidden title, a pairing code, a cookie and the data folder's
path, saved from SETTINGS as a report that carries none of them.
