# Syncing the tablet

Downloading stays in Mihon and Hentoid, on the tablet. tsundoku doesn't
download. What the tablet downloads reaches the workstation through
[Syncthing](https://syncthing.net), and a timer imports it:

1. download on the tablet;
2. Syncthing sends it to `LIBRARY_ROOT` on the workstation
   (`/mnt/hdd2/tsundoku/tablet`);
3. within ten minutes of Syncthing finishing, tsundoku imports it: the band,
   the NEW shelf and covers, the same as START SCAN;
4. delete it on the tablet to free the space. **The workstation keeps it.**

The tablet has far less room than the workstation. The workstation is the
archive; the tablet is a place to download.

## How it's set up

| Piece                  | Where                                                                           |
| ---------------------- | ------------------------------------------------------------------------------- |
| Syncthing, workstation | `syncthing.service`, a user unit (Arch's package). GUI on `127.0.0.1:8384`.     |
| Syncthing, tablet      | Syncthing-Fork (F-Droid or Play), kept by researchxxl since Catfriend1 retired. |
| The import timer       | `ops/systemd/tsundoku-sync.{service,timer}`: every 10 minutes, 5 after boot.    |
| The timer's step       | `scripts/sync-import.ts` (`yarn run sync-import`)                               |
| Accepting the folders  | `scripts/sync-setup.ts` (`yarn run sync-setup`)                                 |
| The rules              | `src/lib/import/sync.ts`, tested in `tests/sync-domain.spec.ts`                 |

Three folders are synced, each landing where the importer looks:

| On the tablet                                                  | On the workstation     |
| -------------------------------------------------------------- | ---------------------- |
| Mihon's storage folder (`downloads/`, `local/`, `autobackup/`) | `LIBRARY_ROOT/Mihon`   |
| Hentoid's library folder                                       | `LIBRARY_ROOT/Hentoid` |
| The EPUB folder (`Documents/Library`)                          | `LIBRARY_ROOT/Library` |

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

Back on the workstation:

```sh
yarn run sync-setup                          # what the tablet offers; changes nothing
yarn run sync-setup -- --device <tablet ID>  # accept the tablet
yarn run sync-setup -- --apply               # accept the three folders
```

A folder whose label isn't recognised is left for `--as <folder id>=Mihon`
(or `Hentoid`, `Library`).

The first scan compares the tablet's files with the copy already here. Files
that match are hashed, not sent. On `/mnt/hdd2` that takes a while for 165 GB,
once.

## Checking on it

```sh
systemctl --user list-timers tsundoku-sync.timer
journalctl --user -u tsundoku-sync.service -n 20   # "still receiving", "nothing new", "import started"
```

Syncthing's own GUI is at `http://127.0.0.1:8384` on the workstation.
