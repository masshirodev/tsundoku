# Database backups

The files under the library root can be scanned again. The database can't be
recreated: ratings, FAV, shelves, groupings, hidden and public flags, the
people you favourited and the whole reading log exist nowhere else. So the
database is snapshotted every night, and before every migration.

## What a snapshot is

`yarn run backup` (`scripts/backup.ts`) runs `VACUUM INTO` against the
database named by `DATABASE_PATH`. `.env` gives it `data/library.sqlite`.

- **It's safe while the server runs.** `VACUUM INTO` copies the database as of
  one transaction, through its own read-only connection. Copying the file
  isn't safe: in WAL mode, the latest writes live in `-wal` until a
  checkpoint.
- **It's checked before it counts.** It's written as `<name>.partial`, opened
  read-only, and must pass `PRAGMA integrity_check`. Only then is it renamed
  into place. A failed snapshot leaves nothing behind and prunes nothing.
- **It's compact.** A vacuumed copy is smaller than the live file: 24 MB for
  the real library of 6,849 series and 50,890 entries (2026-09-23).

Snapshots go to `BACKUP_DIR`, which defaults to `/mnt/backup/tsundoku`. That's
a different disk from both the database (on `/`) and the library files (on
`/mnt/hdd2`). Each is named `<db>-YYYYMMDD-HHMMSS.sqlite` in local time, so
`library-…` and the dev database's `tsundoku-…` sit side by side and never
prune each other.

## Retention

`src/lib/backup/retention.ts` keeps:

- the newest snapshot of each of the last **7 days** that have one;
- the newest of each of the last **8 ISO weeks**;
- the newest of each of the last **12 months**.

One snapshot can count for all three tiers, and the newest one is always kept.
That comes to about 25 files, around 600 MB. Retention only deletes names it
could have written itself. Anything else in the folder is left alone.

## Before a migration

When `getDb()` opens a database that's behind the current rung, it first
writes `<db>-pre-v<N>-<stamp>.sqlite` (`src/lib/server/db.ts`), where N is the
rung about to be climbed. Retention never prunes these. If the snapshot fails
(the disk is full, or `/mnt/backup` isn't mounted), the server still starts
and logs a warning. Keeping the library down over a backup disk would be the
worse failure, and the nightly snapshot is still the safety net. A brand-new
database (rung 0) has nothing to lose, so it's never copied.

## Nightly

`ops/systemd/` holds a user service and timer: 04:00 every night, `Persistent`
so a night the workstation was off is made up at the next boot, at idle I/O
priority. The service calls mise's `node` shim directly, so it doesn't need a
login shell. To install:

```sh
ln -s ~/projects/tsundoku/ops/systemd/tsundoku-backup.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tsundoku-backup.timer
systemctl --user list-timers tsundoku-backup.timer    # when it runs next
journalctl --user -u tsundoku-backup                  # what it said
```

User timers run while you're logged in. For them to run without a session,
run `loginctl enable-linger masshiro`.

## Restoring

1. Stop the server (`yarn run serve`).
2. Check the snapshot: `yarn run backup --verify /mnt/backup/tsundoku/<file>`.
   This prints its rung and how many series and entries it holds.
3. Move `data/library.sqlite` and its `-wal` and `-shm` aside. Don't delete
   them until the restore is confirmed.
4. Copy the snapshot to `data/library.sqlite` and start the server. A snapshot
   from an older rung is migrated forward on open, like any other database.

Reading progress and ratings from after the snapshot are lost. The files on
disk aren't affected, and START SCAN brings back anything imported since.
