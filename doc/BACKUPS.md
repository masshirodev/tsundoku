# Database backups

The files under the library root can be scanned again. The database can't be
recreated (and neither can the highlights' copies, which are mirrored beside
it: "Highlights' copies", below): ratings, FAV, shelves, groupings, hidden and
public flags, the people you favourited and the whole reading log exist
nowhere else. So the database is snapshotted every night, and before every
migration.

## What a snapshot is

`yarn run backup` (`scripts/backup.ts`) runs `VACUUM INTO` against the
database named by `DATABASE_PATH`. A served library's is set in the data
folder's `.env` ([`SERVING.md`](SERVING.md)); a checkout without one uses
`data/tsundoku.sqlite`.

- **It's safe while the server runs.** `VACUUM INTO` copies the database as of
  one transaction, through its own read-only connection. Copying the file
  isn't safe: in WAL mode, the latest writes live in `-wal` until a
  checkpoint.
- **It's checked before it counts.** It's written as `<name>.partial`, opened
  read-only, and must pass `PRAGMA integrity_check`. Only then is it renamed
  into place. A failed snapshot leaves nothing behind and prunes nothing.
- **It's compact.** A vacuumed copy is smaller than the live file: 24 MB for a
  library of 6,849 series and 50,890 entries.

Snapshots go to `BACKUP_DIR` (default `TSUNDOKU_HOME/backups`,
[`DISTRIBUTION.md`](DISTRIBUTION.md)). Put it on a different disk from both the
database and the library files: the workstation's units set
`/mnt/backup/tsundoku`, apart from the database and library on `/mnt/hdd2`.
Each is named `<db>-YYYYMMDD-HHMMSS.sqlite` in local time, so `library-…` and a
development database's `tsundoku-…` sit side by side and never prune each
other.

## Retention

`src/lib/backup/retention.ts` keeps:

- the newest snapshot of each of the last **7 days** that have one;
- the newest of each of the last **8 ISO weeks**;
- the newest of each of the last **12 months**.

One snapshot can count for all three tiers, and the newest one is always kept.
That comes to about 25 files, around 600 MB. Retention only deletes names it
could have written itself. Anything else in the folder is left alone.

## Before a migration

When `getDb()` opens a database that's behind the current migration, it first
writes `<db>-pre-v<N>-<stamp>.sqlite` (`snapshotBeforeMigration`,
`src/lib/server/backup.ts`), where N is the migration about to run. Retention
never prunes these. If the snapshot fails (the disk is full, or the backup
disk isn't mounted), the server still starts and logs a warning. Keeping the
library down over a backup disk would be the worse failure, and the nightly
snapshot is still the safety net. A brand-new database (version 0) has nothing
to lose, so it's never copied.

## Nightly

`ops/systemd/` holds a user service and timer: 04:00 every night, `Persistent`
so a night the workstation was off is made up at the next boot, at idle I/O
priority. After a snapshot it mirrors the highlights' copies ("Highlights'
copies", below), then sweeps `$COVER_DIR/episodes/` of the pictures and
seek-preview sprites of entries that are gone ([`ANIME.md`](ANIME.md),
"Episode pictures"). The service calls mise's `node` shim directly, so it
doesn't need a login shell.

The units are written for the workstation: they run from a checkout at
`~/projects/tsundoku-jobs` (at the installed release's tag, never the working
checkout), read the data folder's `.env`, and set `TSUNDOKU_HOME` and
`BACKUP_DIR` to that machine's disks. Another machine edits those lines. To
install:

```sh
ln -s ~/projects/tsundoku-jobs/ops/systemd/tsundoku-backup.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tsundoku-backup.timer
systemctl --user list-timers tsundoku-backup.timer    # when it runs next
journalctl --user -u tsundoku-backup                  # what it said
```

User timers run while you're logged in. For them to run without a session,
run `loginctl enable-linger "$USER"`.

## Highlights' copies

A highlight's text lives in the database, so the snapshot holds every quote,
note and pointer ([`HIGHLIGHTS.md`](HIGHLIGHTS.md)). Its copy does not: a
page's image and a clip's video live in the data folder's `highlights/`
(`HIGHLIGHTS_DIR`, default `TSUNDOKU_HOME/highlights`), outside the library
folder, so the files under the library root are not where a lost one could be
scanned back from. So `takeSnapshot` (`src/lib/server/backup.ts`) also mirrors
that folder into `BACKUP_DIR/highlights/`, after the snapshot is safely in
place (`mirrorHighlights`):

- **What is gone is decided by the rows, never by the folder.** The mirror
  reads the `copy_path` and `still_path` of every row in the snapshot it just
  took (opened read-only, `namedCopies`), the deleted ones still inside their
  UNDO window included, because a row is what a restore brings back. A name
  that is absolute or climbs out of the folder (`../`) is ignored.
- **What a row names and is new or changed in size is copied**, under a
  `.partial` name and renamed into place; a copy never changes once made, so a
  night copies only the copies made since the last.
- **A mirrored copy no row names** (its highlight deleted for good) is set
  aside under `highlights/.gone/<night>/`, not erased, and those go after 30
  days (`GONE_DAYS`): a snapshot from within that time still finds its copies.
- **A row whose copy is missing from the folder keeps its mirrored copy**
  (counted as `missing`): the mirror is then the only copy left.
- **A missing source touches nothing.** When the highlights folder does not
  exist, or lists no file while rows name copies (an unmounted data disk, a
  wrong `HIGHLIGHTS_DIR`), the night copies, sets aside and prunes nothing and
  says `skipped: 'no source'`. Read the other way, as "every copy was
  deleted", one such night would set every copy aside and the next month
  would erase them.
- **Retention never touches it**: it prunes only the names it writes, and the
  mirror's folder is none of them.
- **Every night says what the mirror did**, on the line after the snapshot's
  `saved …` and its `pruned …` lines: `highlights' copies: 3 copied, 120 kept,
0 missing, 0 set aside, 0 pruned`, or `highlights' copies: skipped (no
source), nothing copied or set aside`, so a night an unmounted data folder
  skipped is in the unit's journal, not silent.
- **A mirror that fails costs the run, not the database or the sweep.**
  `takeSnapshot` catches the mirror's error (an ENOSPC, an EACCES, a file where
  `BACKUP_DIR/highlights/` should be) and returns it as `copiesError`, with
  `copies: null`; the snapshot is already in place and pruned. The script
  prints `highlights' copies failed: …`, still runs the episode files' sweep,
  and only then exits 1, so the unit is marked failed. A partial mirror's
  counts go with its error; the next night copies what this one didn't.

The pre-migration snapshot (above) copies the database alone; the nightly run
is the one that mirrors.

To restore the copies, copy `BACKUP_DIR/highlights/` (without `.gone/`, or
with the night's set-aside ones if the snapshot is older) back over the data
folder's `highlights/` before starting the server.

## Restoring

1. Stop the server.
2. Check the snapshot: `yarn run backup --verify <BACKUP_DIR>/<file>`. This
   prints its migration version and how many series and entries it holds.
3. Move the database file (`DATABASE_PATH`) and its `-wal` and `-shm` aside.
   Don't delete them until the restore is confirmed.
4. Copy the snapshot to `DATABASE_PATH` and start the server. A snapshot from
   an older migration is migrated forward on open, like any other database.

Reading progress and ratings from after the snapshot are lost. The files on
disk aren't affected, and START SCAN brings back anything imported since.
