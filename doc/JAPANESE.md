# Reading Japanese

Phase 2 (card c9): looking words up while reading raw Japanese, and turning
what was looked up into flashcards in Kumiko. Designed in
`Index Japanese.dc.html` and `Japanese States.dc.html` in
[`design/handoff/`](design/handoff/), the handoff for the brief
[`briefs/done/JAPANESE.md`](briefs/done/JAPANESE.md).

Three parts, each its own section: **OCR** reads manga pages into text on the
workstation; **lookup** splits text into words and finds them in JMdict;
**mining** turns looked-up words into cards, only when approved. What differs
from the handoff is under **Departures**.

Japanese is one **language pack** of the lookup; the language-agnostic contract,
and the English pack that is its first other user, are in
[`LANGUAGES.md`](LANGUAGES.md).

## kotoba: the lookup yomu and tsundoku share

The tokenizer, JMdict, furigana, romaji and the mining rules live in
**kotoba** (`~/projects/kotoba`, `masshirodev/kotoba`, private), extracted from
yomu on 2026-09-23 so neither app copies the other; yomu has used it since
2026-09-24 (its own copies are gone). tsundoku depends on it by
path (`"kotoba": "link:../kotoba"`); its README says how an app sets up.

- `kotoba` (browser): `tokenize` with kuromoji, `furigana`, `toRomaji`,
  `isMineable`, `rankCandidates`.
- `kotoba/server`: `lookup` in JMdict (SQLite).

tsundoku serves kuromoji's dictionary itself from `static/dict` (~18MB,
copied by `yarn prepare`, gitignored). The service worker never precaches it.
JMdict is the one database both apps read: `KOTOBA_JMDICT`, by default
`~/.local/share/kotoba/jmdict.db` (74MB; `node ../kotoba/scripts/build-dict.js
--out ~/.local/share/kotoba/jmdict.db` makes it in about 8 seconds).

`GET /api/define?lemma=&surface=&reading=` answers a tapped word's entries:
up to three, common ones first, tried by dictionary form, then as written,
then as read (`src/lib/server/japanese/dict.ts`). There's no deinflection of
its own: kuromoji's base form already turns 見開かれて into 見開く.

## OCR

[mokuro](https://github.com/kha-white/mokuro) reads manga pages into **text
blocks**, one per speech bubble or caption: its box, whether it's vertical,
and its lines. It runs on the workstation's RTX 3050, from a virtualenv on the
library disk (`TSUNDOKU_HOME/mokuro/venv`, here `/mnt/hdd2/tsundoku/mokuro/venv`;
torch with CUDA, 5.9GB; `MOKURO_BIN` points elsewhere).

Measured on Sakamoto Days' first chapter (2026-09-24): 54 pages in 88
seconds, 455 blocks, text on 51 pages (the others are covers and splashes).
The dialogue reads clean; stylised title lettering doesn't.

### Which series

`series.ocr`: **1** always, **0** never, **NULL** decides by language — a
series tagged `language:japanese` (Hentoid's untranslated books), or
downloaded from a Mihon source whose folder says "(JA)" (`JAPANESE_SQL`,
`src/lib/server/japanese/ocr.ts`). Novels never: they're text already.

### How a batch runs

`runOcrBatch` takes the waiting chapters, the series read most recently first
and each series' chapters in order:

1. each chapter's pages are written as `0000.jpg`, `0001.jpg`… into a
   scratch folder on the library disk (`OCR_SCRATCH`, default
   `TSUNDOKU_HOME/ocr-scratch/batch-<time>/<entry>/`). Never inside the
   synced folders, which are receive-only (doc/SYNC.md);
2. mokuro reads the whole batch in one run (`--parent_dir`), so its models
   load once (~20s), with the Hugging Face hub offline: the models are cached
   after the first run;
3. each `<entry>.mokuro` is stored: `page_text` (rung 19) keeps a page's
   blocks with their boxes in **fractions of the page**, so they fit the page
   however large it's drawn (`blocksOf`, `src/lib/japanese/ocr.ts`), and
   `entries.ocr_at` marks the chapter read;
4. the scratch folder and mokuro's `_ocr` cache are removed.

A chapter mokuro doesn't produce, or a batch that fails, is marked
`ocr_failed_at` and tried again after a week. mokuro 0.2.5 takes no
`--disable_html`, whatever its README says (the run exits 2); the HTML it
writes goes with the scratch.

### The timer

`ops/systemd/tsundoku-ocr.{service,timer}`: every half hour (10 minutes after
boot), `scripts/ocr.ts` (`yarn run ocr`) reads batches of 10 until nothing
waits or 50 minutes pass. A lock in the scratch folder keeps a second run off
the GPU. It logs counts, never page text.

```sh
ln -s ~/projects/tsundoku/ops/systemd/tsundoku-ocr.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now tsundoku-ocr.timer
journalctl --user -u tsundoku-ocr.service -n 20
```

`GET /api/entries/<id>/text` answers a chapter's blocks by page (null for a
page not read), and `lookedUp`, the end page's count. Hidden means hidden: a
404 while reveal is off. A chapter kept on the tablet keeps its text too
(`src/lib/cache/device.ts`, refreshed on every visit, since OCR often reads a
chapter after it's kept), so lookups work offline.

### On the series screen

Under DIRECTION, on the panel ground (Index Japanese 4a), for every series
that isn't a novel (`ocrLines`, `src/lib/japanese/ocr.ts`):

| State        | First line                     | Second line                                     |
| ------------ | ------------------------------ | ----------------------------------------------- |
| Running      | `41 OF 58 CHAPTERS`, and a bar | `RUNNING ON THE WORKSTATION · CH. 42 NEXT`      |
| First, idle  | `41 OF 58 CHAPTERS`            | `NEXT ON THE WORKSTATION · EVERY HALF HOUR`     |
| Queued       | `0 OF 58 CHAPTERS · QUEUED`    | `WAITING FOR 2 SERIES ON THE WORKSTATION`       |
| Done         | `58 OF 58 CHAPTERS`            | none                                            |
| Some failed  | `55 OF 58 CHAPTERS`            | `3 DIDN'T READ · TRIED AGAIN IN A WEEK`         |
| Not Japanese | `NOT DETECTED AS JAPANESE`     | `OCR MAKES THE PAGES LOOKUP-READY`, and **OCR** |

"Running" means a run holds `ocr.lock` and this series is first in line
(`ocrPlace`); without the lock it's only next, and says so. **OCR** sets
`series.ocr = 1` and the timer takes it from there.

## Lookup

### The tap rule (image reader)

A tap on a text block opens the lookup, even where a block crosses an edge
strip: blocks win. Every other tap does what it always did (READER.md,
"Touch"), and a swipe turns anywhere. With the lookup open, a tap on another
block moves it and a tap anywhere else closes it (the controls stay down).
Right and middle clicks keep their meaning; a left click is a tap.

Blocks are **outlined only while the controls are up**, so their places are
learned without paying for it on every page. **BLOCKS** in READING (a Japanese
series only; this device's, like FIT) makes that ALWAYS or NEVER; a tap on a
block looks it up either way. The outline is 1px ink with a dark edge each
side, so it reads on white paper and black art; the block being looked up is
ringed in the accent (`src/lib/japanese/blocks.ts`, drawn by `PageImage`).

Rings are drawn, and taps hit-tested, in the **drawn image**, not the page's
box (`PageImage`'s text frame, `data-text-frame`). The two differ whenever
`object-fit: contain` letterboxes the page. A phone in FIT SCREEN caps the
width, so the box takes the screen's shape. Placed in the box's fractions, every
ring sat off its text by up to half the letterbox: too high on the top half of
the page.

A page OCR hasn't read yet says **NO TEXT YET · OCR · 12 OF 58** in a dashed
cell in the top bar, only with the controls up.

### The panel

`src/lib/components/japanese/LookupPanel.svelte`, shared by both readers. It
takes the half of the screen away from the block (`placement`,
`src/lib/japanese/panel.ts`): rising from the bottom for a block in the top
half of a portrait screen, hanging from the top otherwise; a 420px column on
the far side in landscape. On a phone (under 600px) it rises from the bottom
and the page slides up until the block clears it, and back on close. In
vertical scroll the strip holds still while it's open.

The block's text is set **horizontally, with furigana**, whatever it was on the
page: the words become wide tap targets in reading order. Tokenizing and
readings run **on the device** (kotoba, kuromoji), so they work offline; the
meanings come from JMdict on the workstation (`/api/define`), up to three
entries with three senses each, COMMON only where JMdict says so. Offline the
panel says **○ NO MEANINGS OFFLINE**.

The footer says what was logged: `LOGGED · 3RD LOOKUP` / `7 THIS SESSION`
(today, the workstation's day); incognito, `NOT LOGGED · NO CANDIDATES` under
a dashed rule; offline, `LOGGED ON THIS DEVICE`, queued in `localStorage`
(`tsundoku.lookups`, up to 500, `src/lib/japanese/lookups.ts`) and sent with
their own times when the workstation answers again.

### NOT TEXT

OCR sometimes reads a drawing as text. **NOT TEXT** in the panel's header takes
that block out of its page (`POST /api/entries/<id>/text` `{drop}`); a band at
the foot says `BLOCK 2 · NOT TEXT · NO LONGER TAPPABLE` with **UNDO**
(`{restore}`) until the next tap. The page drops it at once; if the workstation
doesn't take it, it comes back.

The block isn't deleted: rung 21 keeps it in `not_text` with where it was.
Once the band is gone, the series screen's OCR row says **2 MARKED NOT TEXT**
with **RESTORE**, which puts every such block of the series back
(`restoreNotText`). A chapter OCR reads again keeps them out. Until
2026-09-24, NOT TEXT deleted outright; the owner lost a block to a stray tap
before UNDO, and it was put back by reading the chapter again.

### In a book (text reader)

A Japanese EPUB (`dc:language` `ja…`) looks words up with a **long press**
(450ms) on a word: the paragraph goes to the same panel, opened on the word
pressed, as a 420px column on the side away from the finger (from the bottom on
a phone). Furigana already in the book (`rt`) isn't read as text. The panel is
headed `LOOKUP · CH. 212 · ¶ 1` and has no NOT TEXT. Taps keep turning pages
and showing the controls (see Departures).

**The panel's foot** (c702, Novel J2 and J3) gains HIGHLIGHT, NOTE and SELECT MORE
over its LOGGED line, in the text reader only: HIGHLIGHT keeps the word the panel
has selected, NOTE keeps it and opens its sheet on the note, and SELECT MORE
closes the panel with that word as a selection with handles and the reader's bar
(with LOOK UP on it, the one language that has a pack). In incognito and a
browsing record, HIGHLIGHT and NOTE aren't offered. A long press on a Japanese
book is still the lookup: selecting is its foot's, or a mouse's drag.

## Mining

Every lookup is logged (`lookups`, rung 20: series, chapter, where, the
word's dictionary form, as met, its reading and part of speech, and the block
or paragraph as its sentence). Looked-up words become **candidates**; a
candidate becomes a card in Kumiko **only when approved**, in a batch.
Auto-mining floods a deck, so it never happens. kotoba's `isMineable` drops
particles, auxiliaries, interjections and single-kana stutters, and
`rankCandidates` merges each word's lookups, counting separate days as
sessions, as yomu does.

### The words screen

`/words` (Index Japanese 3a), reached from the end page's **WORDS** row
("7 LOOKED UP IN CH. 41 · REVIEW →", absent in incognito and when nothing was
looked up), the series screen's **WORDS** row ("14 TO REVIEW · 31 SENT"), and
**`/words`** typed in search.

Each row: the word with its reading, its first meaning, the sentence it was
last met in with the word marked, and where (`SERIES · CH. 41 · P. 14 · ×3`).
**✓** marks it approved (accent), **✕** rejected (inverted, the row dimmed);
unmarked words stay for next time. Tabs filter by series; REJECT ALL and
APPROVE ALL mark what the tab shows. **SEND N TO KUMIKO** records the rejected
(`mined.status = 'rejected'`, never shown again) and sends the approved.
Hidden series' words, their tab and their counts exist only with reveal on.

### Kumiko

Approved words go to yomu's deck, as yomu makes them (kotoba's `composeCard`:
the word with furigana, its glosses, the sentence), tagged
`tsundoku,<series-slug>`: `POST {KUMIKO_URL}/api/flashcards/notes`, one per
word, with `KUMIKO_TOKEN` and `KUMIKO_DECK` from `.env` (`KUMIKO_URL` defaults
to `https://kumiko.ink`). A word counts as sent only once Kumiko answers with
the note's id. Until then it's `pending`: the screen says **KUMIKO DID NOT
ANSWER · N APPROVED ARE KEPT** (or **KUMIKO ISN'T SET UP** without the
token), keeps them marked, and **RETRY SEND** sends them again.

## Departures from the handoff

- **Candidates newest first**, as the handoff draws them, not in kotoba's score
  order; the score still decides what's mineable.
- **No "· PAST"** after the inflection (`描いた ← 描く`): kuromoji gives the
  base form, not the conjugation's name.
- **No blocks on a split or turned wide page**: the half or the turn isn't
  where OCR saw the text. They come back with WIDE PAGES on WHOLE.
- **In a book, a long press, not a tap.** A book's page is all text; if a tap
  looked up, pages could never turn or show the controls by tapping.
- **The series OCR row shows on every manga, manhwa and doujin**, as 4a's
  NOT DETECTED frame implies, so a series the workstation missed can be
  switched on.
- **"KUMIKO ISN'T SET UP"** is a state the handoff doesn't draw: the failed
  state's words, for a workstation with no token yet.

## Tests

- `tests/ocr-domain.spec.ts`: blocks in fractions, page names, the block under
  a tap.
- `tests/ocr-db.spec.ts`: which series queue, a batch end to end with a
  stand-in mokuro (one run, every page stored, scratch cleaned), a failed run
  waiting a week, the series' place in the queue, hidden text hidden.
- `tests/japanese-dict.spec.ts`: lookups through kotoba against the real
  JMdict, with words from Sakamoto Days (skipped without it).
- `tests/panel-domain.spec.ts`: where the panel goes, parts of speech,
  inflection, ordinals, blocks under a crop.
- `tests/blocks-domain.spec.ts`: outlines, blocks under a crop, the block under
  a tap, the OCR row's lines, `/words`.
- `tests/mining-db.spec.ts`: logging (and hidden series refused), candidates,
  SEND against a stand-in Kumiko (sent only with a note id, the rest kept),
  counts.
- `tests/japanese-flow.e2e.ts`: the seed's Drawing carries the handoff's three
  bubbles on its read chapters (`src/lib/server/fixtures.ts`). Outlines with
  the controls, a tap on a block, moving and closing the panel, incognito's
  footer, NOT TEXT and UNDO, BLOCKS, and a word through `/words` to an unset
  Kumiko and the series screen's rows.
