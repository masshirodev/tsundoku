# Syncing the tablet

Downloading is Mihon's and Hentoid's on the tablet, and tsundoku's own on the
workstation ([`DOWNLOADING.md`](DOWNLOADING.md)). What the tablet downloads
reaches the workstation through [Syncthing](https://syncthing.net), and a timer
imports what the importer reads:

1. download on the tablet;
2. Syncthing sends it to `LIBRARY_ROOT` on the workstation
   (`/mnt/hdd2/tsundoku/tablet`);
3. within ten minutes of Syncthing finishing, tsundoku imports the tablet's
   `Hentoid/` books and `Library/` EPUBs — the band, the NEW shelf and covers,
   the same as START SCAN — and the `Mihon/autobackup` backup beside them,
   which names a series and its chapters but attaches no files. A Mihon
   download is **not** imported (c191): `Mihon/downloads/` and `Mihon/local/`
   are synced and kept, and no source reads them;
4. delete it on the tablet to free the space. **The workstation keeps it.**

The tablet has far less room than the workstation. The workstation is the
archive; the tablet is a place to download. The phone and a Waydroid
container on the workstation download too (below, "Other devices").

## How it's set up

| Piece                  | Where                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| Syncthing, workstation | `syncthing.service`, a user unit (Arch's package). GUI on `127.0.0.1:8384`.     |
| Syncthing, tablet      | Syncthing-Fork (F-Droid or Play), kept by researchxxl since Catfriend1 retired. |
| The import timer       | `ops/systemd/tsundoku-sync.{service,timer}`: every 10 minutes, 5 after boot.    |
| The timer's step       | `scripts/sync-import.ts` (`yarn run sync-import`)                               |
| Accepting the folders  | `scripts/sync-setup.ts` (`yarn run sync-setup`)                                 |
| The rules              | `src/lib/import/sync.ts`, tested in `tests/sync-domain.spec.ts`                 |

Three folders are synced, each landing in the library folder:

| On the tablet                                                  | On the workstation     |
| -------------------------------------------------------------- | ---------------------- |
| Mihon's storage folder (`downloads/`, `local/`, `autobackup/`) | `LIBRARY_ROOT/Mihon`   |
| Hentoid's library folder                                       | `LIBRARY_ROOT/Hentoid` |
| The EPUB folder (`Documents/Library`)                          | `LIBRARY_ROOT/Library` |

Of the Mihon folder only `autobackup/` is read (c191): the backup names the
series and its chapters, and attaches no file. `downloads/` and `local/` are
synced and kept and read by nothing, so a chapter downloaded on the tablet
arrives as a file no source takes, and the backup names it as not downloaded.

### Deletes are ignored, on purpose

On the workstation every synced folder is **receive-only** with
**`ignoreDelete`**:

- receive-only: nothing on the workstation is ever sent to the tablet, so the
  archive doesn't fill the tablet back up;
- `ignoreDelete`: a delete on the tablet is not carried out here.

Syncthing's documentation calls `ignoreDelete` "highly discouraged". It's
discouraged for folders meant to be mirrors, and this one is an archive.

It has one consequence that needs handling. A file that exists on the tablet
only for a moment would stay here forever. Mihon downloads a chapter into
`<chapter>_tmp` (a CBZ into `<chapter>.cbz_tmp`) and renames it when it's done;
other apps write `.tmp` and `.part`. Each folder's `.stignore` keeps them out
(`IGNORE_PATTERNS`), and it's written before the folder is added, so nothing
slips in while it starts.

A chapter Mihon renames for another reason (a source renaming its chapters)
leaves the old copy here too. The importer finds entries by their source URL
from Mihon's backup, so the old file is an extra file on disk, not a second
chapter.

### Never press "Revert Local Changes"

Everything the tablet no longer has shows up in Syncthing's GUI on the
workstation as a **local change** of the receive-only folder. That's the
archive working. **Revert Local Changes deletes it all.** Leave the count
alone.

### Why the app imports, not the timer

`sync-import` doesn't import. It asks the running app to, with
`POST /api/scan` (signed in from `TSUNDOKU_TOKEN`, the way the tablet is;
neither is printed). An import running in a second process beside a START
SCAN would race it: the in-process guard only sees its own process, and a
second run marks the first one's job as finished. So there is one importer,
the app. If the app isn't running, the timer logs it, and the next run tries
again.

It only asks when:

- **every synced folder is idle with nothing left to receive** (`/rest/db/status`:
  `state` `idle`, `needFiles` 0). A chapter half received would import with
  half its pages;
- **one has received something since the last import.** Each folder's
  `sequence` moves when it takes in a change. The last imported sequences are
  kept in `~/.local/state/tsundoku/sync.json`, written only once the app
  accepted the scan.

`yarn run sync-import -- --force` asks regardless of the sequences.

## Other devices

The tablet (a Xiaomi Pad, `21051182G`), the phone (a Galaxy Z Fold6,
`SM-F956B`) and Waydroid on the workstation (below) all download, and all
sync. Each device keeps its own copy:

| Device   | On the workstation                                    | Read now                                     |
| -------- | ----------------------------------------------------- | -------------------------------------------- |
| Tablet   | `LIBRARY_ROOT/{Mihon,Hentoid,Library}`                | `Hentoid` and `Library`; `Mihon` is a backup |
| Phone    | `LIBRARY_ROOT/devices/phone/{Mihon,Hentoid,Library}`  | `Hentoid` and `Library`                      |
| Waydroid | `LIBRARY_ROOT/devices/waydroid/Mihon`                 | nothing (c191)                               |
| tsundoku | `LIBRARY_ROOT/devices/tsundoku/Mihon`                 | all of it: its own downloads                 |
| Suwayomi | `LIBRARY_ROOT/devices/suwayomi/Mihon` (retired, kept) | nothing (c191)                               |

**A `Mihon/` folder is read as a device only for tsundoku's own downloads**
(c191, [`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Where it reads from"). The
tablet's, the phone's and Waydroid's are mirrors the importer no longer scans;
their rows and files stay in the library, untouched. A backup is read from the
library's own `Mihon/autobackup`, wherever it came from.

tsundoku's downloads are written here into their folder directly
([`DOWNLOADER.md`](DOWNLOADER.md)); Suwayomi's folder is what it wrote until it
was retired (c129), and is not read any more.

Why not one shared folder: the same chapter downloaded on both devices would
be two versions of one path, and Syncthing would keep a conflict copy. So the
devices stay apart on disk, and the importer merges their Hentoid and Library
copies. (Before c191 each device's Mihon backup was read too, and one device's
would have replaced the other's every scan; now only the library's own backup
is read, at `LIBRARY_ROOT/Mihon/autobackup`.)

**The importer reads what it is given** (`sourcesIn`, src/lib/server/import/index.ts):
the library folder's own sources, then each folder under `devices/` — but only
a Hentoid copy, a Library of books, and tsundoku's own `Mihon/`. A series is
keyed the same on every device, so the phone's copy of a Hentoid book is found
as the same series:

- Mihon: `mihon:<source>:<url>`, from a backup;
- Hentoid: `hentoid:<site>:<url>`;
- EPUB: `epub:Library/<path>`, named from the device's own folder.

What that means for each series:

- **One series, chapters from whichever device has them.** A series with files
  on both devices takes the folder they share as its path, and each entry
  names its file from there (`widenTo`, src/lib/server/paths.ts):
  `H/.Hentoid/…` from the tablet, `devices/phone/H/.Hentoid/…` from the phone.
  Everything that reads a file joins the series path and the entry's file, so
  nothing else needed to know.
- **A chapter both devices have** keeps the copy already there. The second
  device's copy is on disk, unused.
- **A series only one device has** stays in that device's folder, as before.
- **Missing is per device.** A device answers only for files in its own
  folder, so the phone deleting a chapter never marks the tablet's copy not
  downloaded. Deletes are ignored on the workstation anyway (above), so this
  only comes up when a file is deleted here.
- **One root per source.** The phone's Hentoid and Library join the tablet's
  roots of the same name (`ensureNamedRoot`). There's one hidden Hentoid shelf,
  and a book grouped on the tablet is still found when the phone has it.
- **A folder one device's download is keyed by** (`mihon-dir:…`, while no
  backup lists the manga yet) is the same series as the one the backup this
  plan carries names — this device's own, or the library's own — and the two
  are settled before anything is written
  ([`IMPORT-MIHON.md`](IMPORT-MIHON.md), "Before the backup knows it"; c89).
- **Read progress** comes from the library's own Mihon backup — the tablet's
  `Mihon/autobackup`, which lands at `LIBRARY_ROOT/Mihon` — and only moves
  forward. A phone's or Waydroid's backup under `devices/<name>/Mihon/` is
  not read (c191), so reading on those no longer arrives.

Grouping books and MOVE TO… name each book's file the same way
(`rehome`, src/lib/server/books.ts). Grouping a tablet book with a
phone-only one keeps both readable. Before this, grouping books from two
folders silently broke the one not in the new series' folder.

Tested in `tests/devices-import-db.spec.ts`.

## Setting it up

On the workstation (done 2026-09-23):

```sh
sudo pacman -S syncthing
systemctl --user enable --now syncthing.service
syncthing cli show system | grep myID        # this box's device ID
ln -s ~/projects/tsundoku/ops/systemd/tsundoku-sync.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now tsundoku-sync.timer
```

On the tablet:

1. Install **Syncthing-Fork** and give it **All files access**. In Android's
   battery settings, set it to **Unrestricted**, or Android stops it in the
   background.
2. **Add the workstation** as a device with its ID. Under the device's
   addresses, add `tcp://workstation.example.ts.net:22000` beside `dynamic`,
   so it connects over Tailscale away from home as well.
3. **Add three folders**, each shared with the workstation, with these
   **labels**, which is how the setup places them: `Mihon`, `Hentoid`,
   `Library`. Set each **Folder type** to **Send Only**. The tablet is the
   source; nothing should ever come back to it.
   - Mihon: the storage location set in Mihon (_Settings → Data and storage_),
     the folder holding `downloads/`, `local/` and `autobackup/`.
   - Hentoid: the library folder set in Hentoid.
   - Library: `Documents/Library`.
4. In Mihon, turn on **automatic backups** (_Settings → Data and storage_),
   every 6 or 12 hours. The backup is where read progress, categories and
   covers come from ([`IMPORT-MIHON.md`](IMPORT-MIHON.md)).

The phone is set up the same way, with the same three labels.

Back on the workstation:

```sh
yarn run sync-setup                                        # what's offered; changes nothing
yarn run sync-setup -- --device <tablet ID> --device <phone ID>   # accept both
yarn run sync-setup -- --apply --device-dir <phone ID>=phone      # accept the folders
```

`--device-dir` puts that device's folders under `devices/phone/`. A device
without one gets the library folder itself, so give it to every device but
the tablet.

A folder whose label isn't recognised is left for `--as <folder id>=Mihon`
(or `Hentoid`, `Library`).

The first scan compares the tablet's files with the copy already here. Files
that match are hashed, not sent. On `/mnt/hdd2` that takes a while for 165 GB,
once.

### Waydroid

Mihon also runs in Waydroid on the workstation itself (set up 2026-10-02), and
syncs like any other device: Syncthing-Fork from F-Droid inside the container,
Mihon's folder only. A bind mount or symlink can't replace it. Waydroid's
shared storage (`~/.local/share/waydroid/data/media`) is owned by Android's
media user (uid 1023), so the host can't read it. A path that isn't a Syncthing
folder would also never move the timer, and nothing would keep a half-written
chapter out.

- The workstation, as Waydroid sees it: `tcp://192.168.240.1:22000`, the
  `waydroid0` bridge. Syncthing listens on every interface, so nothing else
  is needed.
- Syncthing-Fork's **run conditions** default to Wi-Fi only, and Waydroid's
  network isn't Wi-Fi to Android. Turn them off, or it never dials.
- Mihon's folder there is `/sdcard/mihon`, lowercase. The label `mihon` is
  recognised all the same. Accepted with `--device-dir <id>=waydroid`.
- Waydroid's data is on `/`, so its downloads fill the home disk until they're
  deleted in Mihon. The copy here stays (deletes are ignored).
- `adb connect 192.168.240.112:5555` reaches it (the IP is in
  `waydroid status`). Accept the debugging prompt once. `adb push` is how a
  backup gets in, for example to restore the tablet's library into it.

## Checking on it

```sh
systemctl --user list-timers tsundoku-sync.timer
journalctl --user -u tsundoku-sync.service -n 20   # "still receiving", "nothing new", "import started"
```

Syncthing's own GUI is at `http://127.0.0.1:8384` on the workstation.
