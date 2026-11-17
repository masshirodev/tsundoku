# Importing

tsundoku brings a library in from what other reading apps leave behind: a
Mihon backup, a Hentoid folder, EPUB files, and the files its own downloads
wrote. Every importer plans from the files without writing, then hands its
plan to the one writer (`src/lib/server/import/write.ts`), so the rules for
keys, read state and rescanning are shared. The shapes of the files they read
are in [`IMPORT-FORMATS.md`](IMPORT-FORMATS.md).

There are two ways in. **IMPORT A BACKUP** takes one file uploaded in the
browser. **A scan** reads the library folder (`LIBRARY_ROOT`, default
`TSUNDOKU_HOME/library`) and runs every importer whose folder it finds, one
step each, in one job: START SCAN on the empty library, RESCAN in the desktop
sidebar, `/scan` typed in search, `/api/scan`, or `yarn run import` without
the app (`scripts/import.ts`). One import or scan runs at a time.

## IMPORT A BACKUP

A Mihon `.tachibk` chosen on the computer or a phone, uploaded in pieces,
previewed (what it holds, the sources it needs, its categories) and brought in
on IMPORT. It lives at `/import`, reached from GET STARTED's step 03 and from
SETTINGS › 05 — LIBRARY › IMPORT A BACKUP; `/import/log` keeps every import
and scan. Aniyomi and LNReader backups are recognised and refused. Read
[`IMPORT-BACKUP.md`](IMPORT-BACKUP.md).

## Mihon

A Mihon backup dropped in the library's `Mihon/autobackup/` (the newest by
name is read), and tsundoku's own downloads in Mihon's layout under
`devices/tsundoku/Mihon/`. Every series in Mihon's library comes in with its
chapters, read state, history and categories (read as ratings, shelves and
hiding); a gallery source's series come in as books. The backup upload uses
the same plan. Read [`IMPORT-MIHON.md`](IMPORT-MIHON.md).

## Hentoid

A copy of Hentoid's folder at `H/.Hentoid/`, `.Hentoid/` or `Hentoid/` in the
library folder. Every book comes in as a doujin book, with its rating,
favourite, progress and tags, into a hidden root: nothing from it shows until
`/reveal`. Read [`IMPORT-HENTOID.md`](IMPORT-HENTOID.md).

## EPUB

Every `.epub` under the library folder's `Library/` (or `Books/`), at any
depth, as a novel whose entries come from the book's table of contents. A book
tsundoku wrote for a novel it downloads is read back onto that novel's series.
Read [`IMPORT-EPUB.md`](IMPORT-EPUB.md); the reader is
[`TEXT-READER.md`](TEXT-READER.md).

## Video folders

Episodes and films tsundoku downloaded, in Jellyfin's layout, under the
library folder's `Anime/`, `Shows/` and `Movies/`: one source per video kind,
read through their NFO files. Read [`ANIME.md`](ANIME.md), "Downloading", and
[`FILMS-SHOWS.md`](FILMS-SHOWS.md), "Importing".

## Other devices

Another device's synced copy under `devices/<name>/` is read too: its
`Hentoid/` and `Library/` folders, by the same importers. Of the `Mihon/`
folders there, only tsundoku's own is read. Read [`SYNC.md`](SYNC.md), "Other
devices".
