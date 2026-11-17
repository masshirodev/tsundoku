# HELP: a page, and a "?" where the question comes up

Seven short topics, and a "?" on the rows friends ask about. GET STARTED,
topic 01, is [`ONBOARDING.md`](ONBOARDING.md).

## The topics are data

`src/lib/help/topics.ts`: each topic is a number, a title, the meta line that
names its parts, an **IN SHORT** of three lines at most, and its parts (an
anchor, a numbered label with a link to its screen, paragraphs, and a ruled
table where a part explains a screen's words). Not Markdown files: tsundoku
has no Markdown renderer, the topics have a shape, and a "?"'s sheet shows the
same IN SHORT as the page, so the two can't drift. The words are messages
(`help_*` in `messages/`, [`I18N.md`](I18N.md)), in every language the app
has.

| #   | Topic                   | Slug          | Parts                                                                                                                                       |
| --- | ----------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Getting started         | `start`       | opens `/start`, the checklist itself                                                                                                        |
| 02  | Reading                 | `reading`     | turning pages, the strip, full screen and zoom                                                                                              |
| 03  | Finding and downloading | `downloading` | extensions and repositories (both ways in: BROWSE and SETTINGS › 07), online, add/download/follow, the queue; points at GET STARTED's 05–07 |
| 04  | Your phone              | `phone`       | Wi-Fi with a code (and a firewall that keeps the phone out), Tailscale (`#tailscale`, the README's four steps)                              |
| 05  | Updates                 | `updates`     | where it shows, unzipped                                                                                                                    |
| 06  | Backups and importing   | `backups`     | the library folder                                                                                                                          |
| 07  | When something breaks   | `report`      | SAVE A REPORT                                                                                                                               |

**Words to keep true.** They describe the app: when a screen's word changes,
its topic's line changes with it. Backups' THE LIBRARY FOLDER, for one, says
that START SCAN on the empty library, or RESCAN in the sidebar or in MORE
after it asks, reads the folder again, and that `/scan` in search does too
(`help_backups_folder_para`; [`LIBRARY.md`](LIBRARY.md), "RESCAN asks
first"). `tests/help-domain.spec.ts` checks the shape (seven, three lines at
most, unique anchors), that SETTINGS can open every `?section=` a topic links
to, that no address is named, and that nothing mentions series kept private
or the way to show them: help keeps that secret as the rest of the app does.

## Where it lives

- **`/help`**: the seven topics as rows, each naming its parts, so there's no
  search; STILL STUCK under them. 01 counts the checklist, done and skipped
  together (`3 OF 7`), as the sidebar's GET STARTED row does; a topic that
  can't apply here says NOT HERE. On a wide screen it is the list, in a
  column, not an index beside an empty article.
- **`/help/<topic>`**: number, title, parts line, IN SHORT, the parts, ← and
  → between topics, STILL STUCK. From 1024 px the topics' index sits on its
  left, the current one inverted. 07 ends on SAVE → into SETTINGS rather than
  a SAVE on the page: the report is SETTINGS' row, and one place to save it is
  enough.
- **A topic that can't apply here** still opens, with a dashed band under its
  title: UPDATES with no updater (the workstation), YOUR PHONE on a phone
  already in over Wi-Fi.
- **The ways in**: HELP, the last line of the sidebar's foot under SETTINGS;
  HELP → in MORE, counting its topics; `/help` in the search field, and
  `/help <word>` for a topic (`/help phone`).

## The "?"

A 20 px square after a label (`src/lib/components/help/HelpMark.svelte`). The
whole label cell is the button, so the target is the cell, not the square;
pressed or open, the cell inverts. Where the word fills a narrow cell the mark
wraps under it. It sits on six rows:

| Where                                | Opens                              |
| ------------------------------------ | ---------------------------------- |
| SETTINGS › 08 — DEVICES › WI-FI      | 04, at Wi-Fi with a code           |
| SETTINGS › 08 — DEVICES › UPDATES    | 05, at where it shows              |
| SETTINGS › 05 — LIBRARY › REPORT     | 07, at save a report               |
| a series' DOWNLOAD row               | 03, at add, download, follow       |
| EXTENSIONS › REPOSITORIES' 01 label  | 03, at extensions and repositories |
| the reader's READING sheet, before ✕ | 02                                 |

It opens a bottom sheet (`HelpSheet.svelte`): `HELP · 04 — YOUR PHONE`, the
IN SHORT, and WHOLE TOPIC → with where it lands (`OPENS AT 01 — WI-FI WITH
A CODE`). In the reader the READING sheet's rows give way to it instead of a
second sheet stacking, and ← READING brings them back; WHOLE TOPIC says it
leaves the chapter.

**A pointer under IN SHORT**: 03 ends on `GET STARTED walks through it once:
steps 05 to 07.`, in bold, with `05 — 07 →` to `/start#first-read`. It's the
topic's `pointer`, drawn on a line of its own by `InShort.svelte`, so IN SHORT
stays three lines.

## Limits

- No search in HELP: the seven topics fit on one screen.
- The preview of a series not in the library has no "?" on its DOWNLOAD row.
- No topic on keys and accounts (TMDB, Trakt, AniList, MAL): SETTINGS › 06 —
  CATALOGUES' rows carry no "?" ([`TRACKING.md`](TRACKING.md)).

## Tests

`tests/help-domain.spec.ts` (the topics' shape and rules, a "?"'s landing,
NOT HERE, ← and →, `/help` in search); `tests/help-flow.e2e.ts` (the list, a
topic, NOT HERE's dashed band, 01 and an unknown topic, REPORT's "?" and
WHOLE TOPIC, the sidebar's and MORE's ways in); the reader's "?" in
`reader-flow.e2e.ts`, DOWNLOAD's in `downloads-flow.e2e.ts`;
`tests/help-frame.e2e.ts`, the frame of a topic page.
