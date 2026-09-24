# Reading Japanese

Phase 2 (card c9): looking words up while reading raw Japanese, and turning
what was looked up into flashcards in Kumiko. Designed in
`Index Japanese.dc.html` and `Japanese States.dc.html` in
[`design/handoff/`](design/handoff/), the handoff for the brief
[`briefs/done/JAPANESE.md`](briefs/done/JAPANESE.md).

Three parts, each its own section: **OCR** reads manga pages into text on the
workstation; **lookup** splits text into words and finds them in JMdict;
**mining** turns looked-up words into cards, only when approved.

## kotoba: the lookup yomu and tsundoku share

The tokenizer, JMdict, furigana, romaji and the mining rules live in
**kotoba** (`~/projects/kotoba`, `masshirodev/kotoba`, private), extracted from
yomu on 2026-09-23 so neither app copies the other. tsundoku depends on it by
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
library disk (`/mnt/hdd2/tsundoku/mokuro/venv`, torch with CUDA, 5.9GB;
`MOKURO_BIN` points elsewhere).

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
   `/mnt/hdd2/tsundoku/ocr-scratch/batch-<time>/<entry>/`). Never inside the
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
page not read). Hidden means hidden: a 404 while reveal is off.

## Mining

Every lookup is logged; looked-up words become **candidates**; a candidate
becomes a card in Kumiko **only when approved**, in a batch. Auto-mining
floods a deck, so it never happens. kotoba's `isMineable` drops particles,
auxiliaries, interjections and single-kana stutters, and `rankCandidates`
weights separate sessions above the raw count, as yomu does.

(The review screen and the Kumiko client are being built; this section grows
with them.)

## Tests

- `tests/ocr-domain.spec.ts`: blocks in fractions, page names, the block under
  a tap.
- `tests/ocr-db.spec.ts`: which series queue, a batch end to end with a
  stand-in mokuro (one run, every page stored, scratch cleaned), a failed run
  waiting a week, hidden text hidden.
- `tests/japanese-dict.spec.ts`: lookups through kotoba against the real
  JMdict, with words from Sakamoto Days (skipped without it).
