# ops

What builds, ships and runs tsundoku outside the app's own code. Two of these
folders are general, and three describe the author's own machines.

**General**, usable by anyone building tsundoku:

- `release/`: the release toolchain (`doc/RELEASE.md`): the build, the
  launcher and tray every bundle carries, the Windows installer, the Android
  APKs, the smoke test, publishing, and each version's notes.
  `release/README.txt` is the README shipped inside a bundle, written for the
  person who installs it.
- `engine/`: a compose file running the extension engine and FlareSolverr for
  development (`doc/EXTENSION-ENGINE.md`).

**This deployment's own**: they name one computer's paths, VM and SSH host,
and are kept as a worked example, not as something to run unchanged:

- `systemd/`: the user units that serve the library and run the nightly
  backup, OCR and sync jobs on the workstation (`doc/SERVING.md`).
- `workstation/`: `install-release.sh`, which puts a published release on the
  workstation (`doc/SERVING.md`).
- `winvm/`: `zen.sh`, which drives the Windows VM the smoke test's Windows half
  runs on (`doc/WINDOWS-VM.md`).

"The workstation", here and in the docs, is the computer that serves the
author's library. Where a general script defaults to one of its paths
(`RELEASE_DIR`, `ENGINE_DATA` under `/mnt/hdd2/tsundoku`), the default is this
deployment's: set the variable to your own folder. The smoke test's Windows half
expects a VM reachable as `ssh win-test` and `ops/winvm/zen.sh` to start and
roll it back; without one, its Linux half runs alone
(`ops/release/smoke.sh <version> linux-x64`), though `publish.ts` wants the
whole run.
