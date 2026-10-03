# Downloading on the workstation

Mihon on Android (tablet, phone, Waydroid) keeps pausing and halting its
downloads, however much leeway it's given. The workstation doesn't. So
manga can also be downloaded here, by
[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), which runs
Mihon's own extensions (the [Keiyoushi](https://keiyoushi.github.io) repo) on
the JVM. tsundoku still doesn't download anything itself
([`ARCHITECTURE.md`](ARCHITECTURE.md), "Web novels"): Suwayomi writes files,
and tsundoku imports them.

Set up 2026-10-03 (c75).

## The idea: Suwayomi is one more device

Suwayomi writes **Mihon's download layout**, and its backups are **Mihon's
`.tachibk`**. So it gets a device folder like the phone and Waydroid
([`SYNC.md`](SYNC.md), "Other devices"), and the importer reads it with no
code of its own:

```
$LIBRARY_ROOT/devices/suwayomi/Mihon/
  downloads/<Source> (<LANG>)/<Series>/<Scanlator>_<Chapter>.cbz
  autobackup/org.suwayomi.tachidesk[.auto]_<date>_<time>.tachibk
```

Measured 2026-10-03 against Suwayomi v2.4.2366 and the tablet's copy of the
same chapters:

- **Source ids are Mihon's.** The id belongs to the extension, not the app, so
  a series is keyed `mihon:<source id>:<url>` as on the tablet. All nine
  sources of the library that Keiyoushi has matched by id.
- **Chapter URLs are the same** (`/chapters/01J76…` for Weeb Central).
- **The folders are Mihon's,** one level down: Suwayomi writes them under
  `downloads/mangas/`, so that subfolder is what's mounted here.
- **The CBZs differ in small ways:** no `_<hash>` suffix in the name, pages
  deflated rather than stored (`src/lib/server/zip.ts` reads both),
  `<Translator>` filled in, and no `<SourceMihon>` (the folder name gives the
  source).
- **The backup decodes** with the Mihon reader as it is.

So a series Suwayomi downloads that the tablet also has becomes **one
series**, its chapters from whichever device has them. A chapter both have
keeps the copy already there. That was checked on the live library with The
Spark in Your Eyes: the tablet's 212–218, Suwayomi's 219, one series.

## How it's set up

| Piece                 | Where                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| The container         | `ops/suwayomi/compose.yml` (`ghcr.io/suwayomi/suwayomi-server:stable`)   |
| Its unit              | `ops/systemd/tsundoku-suwayomi.service`, a user unit                     |
| Its data              | `/mnt/hdd2/tsundoku/suwayomi` (database, settings, extensions)           |
| Downloads and backups | `$LIBRARY_ROOT/devices/suwayomi/Mihon/{downloads,autobackup}`            |
| Web UI                | `http://127.0.0.1:4567`, on the workstation only                         |
| The import timer      | `ops/systemd/tsundoku-suwayomi-import.{service,timer}`: every 10 minutes |
| The timer's step      | `scripts/suwayomi-import.ts` (`yarn run suwayomi-import`)                |
| The rules             | `src/lib/import/suwayomi.ts`, tested in `tests/suwayomi-domain.spec.ts`  |

**Docker never starts it on its own** (`restart: 'no'`). The systemd unit does,
with `RequiresMountsFor=/mnt/hdd2`. A container started before the disk is
mounted would write the downloads onto `/`, under the empty mount point.

**The unit makes the mount points first.** The two library folders are
mounted inside Suwayomi's data folder, and Docker would create those mount
points as root, leaving Suwayomi (uid 1000) unable to write next to them.

**localhost only, no login.** Nothing else on the network needs it; it's
used from the workstation's browser. Reaching it from the tablet is a later
decision (below).

Installed 2026-10-03:

```sh
ln -s ~/projects/tsundoku/ops/systemd/tsundoku-suwayomi.service \
      ~/projects/tsundoku/ops/systemd/tsundoku-suwayomi-import.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tsundoku-suwayomi.service tsundoku-suwayomi-import.timer
```

### Extensions

The Keiyoushi repo is set by `EXTENSION_STORES` in the compose file. The
extensions installed are the library's Mihon sources that Keiyoushi has:
Asura Scans, Toonily, Toonily.me, Mangahere, MangaDex, Weeb Central, Omega
Scans, Kumaraw, Webtoons.com. Install more from the web UI (_Browse →
Extensions_).

**XBatCat and Hitomi aren't in Keiyoushi** (71 series of the library between
them: two XBatCat source ids, one Hitomi). They keep downloading on Android
until a repo that carries them is added.

## Using it

1. Open `http://127.0.0.1:4567`, find the series, and **add it to the
   library before downloading**. The backup only carries library series. A
   download of a series not in the library is keyed by its folder
   (`mihon-dir:…`, [`IMPORT-MIHON.md`](IMPORT-MIHON.md)) and won't merge with
   the tablet's copy.
2. Download chapters (or turn on auto-download in Suwayomi's settings).
3. Within ten minutes of the queue emptying, tsundoku imports them: the band,
   the NEW shelf and covers, as START SCAN.

## The import timer

`suwayomi-import` asks the running app to import, never imports itself,
for the reason in [`SYNC.md`](SYNC.md), "Why the app imports, not the timer".
It asks only when:

- **the download queue is empty** (finished items aside), read from
  Suwayomi's GraphQL API. A chapter being written would import with half its
  pages;
- **the downloads changed since the last import**: the count, the bytes and
  the newest mtime of every file, kept in `~/.local/state/tsundoku/suwayomi.json`
  and written only once the app accepted the scan. A count alone would miss
  one chapter deleted and another downloaded.

**Before asking, it takes a backup** (`createBackup`) into `autobackup/`,
keeping its three newest. Suwayomi's own backup is daily. Without a fresh
one, a series added and downloaded since would import keyed by its folder,
then by its URL once the daily backup came, and be two series. Suwayomi's own
`.auto_` backups land in the same folder and are pruned by its `BACKUP_TTL`
(14 days).

`yarn run suwayomi-import -- --force` asks regardless of the fingerprint.
If Suwayomi isn't answering, the timer logs it and does nothing.

## Read progress: tsundoku's

Suwayomi has its own read state. **tsundoku stays the source of truth**:

- what's read in Suwayomi's web UI comes in through its backup and, as with
  every device, **only moves forward**;
- nothing is written back to Suwayomi. It's a downloader here, not a reader.

## Disk

Downloads land on `/mnt/hdd2`, beside the rest of the library. Only the
image (about 1.4 GB) is on `/`. Nothing is deleted: chapters stay until
deleted in Suwayomi, and a delete there marks them not downloaded at the next
import, like any device's.

## Checking on it

```sh
systemctl --user status tsundoku-suwayomi.service
journalctl --user -u tsundoku-suwayomi-import.service -n 20  # "still downloading", "nothing new", "import started"
docker logs --tail 50 tsundoku-suwayomi
```

Updating Suwayomi: `docker pull ghcr.io/suwayomi/suwayomi-server:stable`,
then `systemctl --user restart tsundoku-suwayomi`.

## Not done yet

- **Series Mihon downloaded but never added to its library** (34 on
  2026-10-03) are keyed by folder, so a Suwayomi copy of one is a second
  series. Adopting a `mihon-dir:` series under its `mihon:` key needs entry
  matching across URL forms (ComicInfo's full `Web` URL against the backup's
  path), so it's a card of its own.
- **Driving Suwayomi from tsundoku** (follow a series, download new chapters
  through its GraphQL API) needs a design brief first.
- **Reaching the web UI from the tablet.** It's localhost-only, without a
  login.
