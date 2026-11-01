# The tray: tsundoku with no window

What a friend starts since card c222 ("Run in the background with a tray icon,
not a console window"): `tsundoku.exe` on Windows, `./tsundoku` on Linux. It
starts tsundoku with no console window and no terminal attached, puts the 積
icon in the notification area, and keeps tsundoku to one copy per account.
The launcher underneath is unchanged in what it starts and how it stops it
([`RELEASE.md`](RELEASE.md), "The launcher"). The tray only runs it with no
window and gives a way to quit that isn't closing that window.

The owner, 2026-11-01: "instead of letting ppl see the cmd on windows and the
terminal on linux, can we run it in the bg and add the icon to tray? closing
the terminal wouldnt quit it either that way, opening the app again would open
the browser only too instead of restarting the server."

## What a friend sees

- **Starting it** (Start menu, or double-clicking `tsundoku.exe`; `./tsundoku`
  on Linux): no window. The icon appears by the clock, and the browser opens
  once tsundoku answers, as before. On Linux, `./tsundoku` prints two lines
  and gives the terminal back. Closing that terminal changes nothing.
- **Starting it again** while it runs: the browser opens on the running one.
  Nothing restarts, and this holds while the first is still starting too (the
  browser opens once it's ready).
- **The menu** (right click; a left click opens tsundoku):

  | Item                  | Does                                                          |
  | --------------------- | ------------------------------------------------------------- |
  | Running at http://... | where it serves (greyed); "Starting..." before that           |
  | Open tsundoku         | opens the browser there                                       |
  | Open the logs folder  | the data folder's `logs/`                                     |
  | Start it again        | only after it stopped by itself                               |
  | Quit tsundoku         | stops the app, the engine and FlareSolverr, and then the tray |

- **If tsundoku stops by itself**, the icon stays and the first item becomes
  "It stopped by itself: show its log", which opens `logs/tsundoku.log`.
  The tray never restarts the app by itself: one that stops at once would
  only stop again, unseen. START IT AGAIN, or OPEN, starts it again.
  The launcher still restarts the engine and FlareSolverr on its own, as before.
- **The words** follow the system's language: Brazilian Portuguese on a
  Portuguese system, otherwise English (`strings.go`). The app picks a
  device's language in its own settings ([`I18N.md`](I18N.md)). The tray has
  none, and it starts before the app answers.

From a terminal, `tsundoku.exe --quit` or `./tsundoku --quit` stops the
running copy and returns once everything has stopped (exit 0; 1 if a tray
holds the lock but doesn't answer, or hasn't stopped in 30 s).
`--no-browser` starts it without opening the browser, and is what start at
sign-in and an update's relaunch use.

## Where there's no tray

- **Linux without a tray on the desktop**: GNOME without the AppIndicator
  extension shows no StatusNotifierItem. Hyprland with waybar's `tray`
  module, KDE, XFCE and Cinnamon do. There tsundoku runs all the same, with
  nothing to click: `./tsundoku --quit` stops it, and starting it again
  opens it.
- **No session bus at all** (a container, a bare tty): the tray sees no D-Bus
  (`shell_unix.go`) and runs without an icon. This is the Linux smoke test's
  case.
- **Windows with no taskbar**: an SSH session, like the smoke test's, or a
  sign-in where the Startup folder runs before Explorer has made the
  taskbar. The tray waits up to a minute for `Shell_TrayWnd` before adding its
  icon (`shell_windows.go`), because fyne.io/systray, given no taskbar,
  fails to add the icon and then never builds its menu, even once the
  taskbar comes. Without one after a minute, it runs without an icon. A
  `--quit` during that minute ends the wait at once, so the lock isn't held
  past it.

## The old way is still there

`tsundoku.cmd` (Windows) and `./tsundoku --foreground` (Linux) run the
launcher in a window, as every release before c222 did: closing the window
stops tsundoku. Reset password (`--reset-password`, the Start-menu entry)
goes that way too, since it has something to say and waits for Enter. The
Tailscale and Wi-Fi smoke stages still start `tsundoku.cmd`: they test the
network, not how it starts.

## How it's built

`ops/release/tray/` is a small Go program, built by `yarn run release`
(`buildTray` in `ops/release/release.ts`) for each platform from the tag's own
copy:

- **Windows**: `tsundoku.exe` at the bundle's root, linked with
  `-H windowsgui`, which makes it a GUI program: started, Windows gives it
  no console. The release reads the PE header back and fails if the
  Subsystem isn't 2 (GUI). go-winres gives it the 積 icon (the installer's
  `tsundoku.ico`), version info, and a manifest with DPI awareness.
- **Linux**: `launcher/tsundoku-tray`, which `./tsundoku`, still a shell
  script, hands over to.
- **Pure Go, no cgo**, so the workstation cross-compiles Windows' with no
  Windows toolchain. fyne.io/systray draws the icon: the Win32 notification
  area on Windows, a StatusNotifierItem over D-Bus (godbus) on Linux.
  go-winres is a `tool` in `go.mod`, so its version is pinned with the
  rest. The modules linked into each binary (`go version -m`) are listed in
  that bundle's `THIRD-PARTY-NOTICES.txt` with their licence texts.
- **Icons** are committed copies in `tray/icon/`, since Go embeds them:
  Windows' `.ico` is the installer's, and Linux's is a 64 px PNG of the
  glyph. `ops/release/installer/icon.sh` makes all three, and
  `tests/tray-icons.spec.ts` fails if the tray's `.ico` isn't the
  installer's.

Why not something smaller, written down so it isn't re-argued:

- A `.vbs` that starts the `.cmd` hidden relies on VBScript, which Windows
  is removing.
- A PowerShell `NotifyIcon` is Windows-only, costs a second to start, and
  hidden PowerShell is a pattern antivirus flags.
- Node tray modules ship native binaries per platform and are mostly
  unmaintained.

The Go program costs about 6 MB per bundle.

## How it works

```
tsundoku.exe / launcher/tsundoku-tray      the tray (Go)
  └─ node launcher/launch.ts --tray        the launcher, no window
       ├─ node app/scripts/serve.ts        the app
       ├─ java -jar engine/engine.jar      the engine
       └─ flaresolverr                     if it's unzipped
```

**One copy per account.** The tray takes `tray.lock` in the default data
folder (`%LOCALAPPDATA%\tsundoku`, `~/.local/share/tsundoku`: `defaultHome`,
as `data-dirs.ts` says it, never a `TSUNDOKU_HOME` elsewhere, since one tray
per account is the rule wherever the library is). The lock is `LockFileEx` or
`flock`, which the system lets go of when the process ends however it ends,
so a crashed tray leaves no stale lock behind. It then listens on
`127.0.0.1:<any>` and writes the port, its pid and a random token to
`tray.json` (0600). A second start reads it and POSTs `/open` (or, for
`--quit`, `/quit`) with the token in `X-Tsundoku-Tray`. If nobody answers,
the file is a dead tray's, and the new start takes over. A start that
loses the race for the lock waits for the winner's `tray.json` and asks it
to open. The token keeps another account on the same computer from quitting
this one's tsundoku.

**Detaching on Linux.** `./tsundoku` starts the tray again with `setsid` and
stdio on `/dev/null` (`detach` in `proc_unix.go`), says where it went, and
exits. In a session of its own, the tray gets no SIGHUP when the terminal
closes. Windows needs nothing: a GUI program has no console to lose.

**No window for anything under it.** The tray starts the launcher with
`CREATE_NO_WINDOW`, so the launcher has a console that's never shown. Every
console program it starts (node, java, ffmpeg, `tailscale.exe`, `taskkill`)
shares that console instead of opening its own. The launcher also passes
`windowsHide` to its own `taskkill`.

### Talking to the launcher

`launch.ts --tray` changes three things (the rest is the launcher as ever):

- **Its own lines go to `logs/launcher.log`** (stamped and rotated like the
  others, [`LOGS.md`](LOGS.md)), not to stdout. Nobody reads a hidden
  console, and SAVE A REPORT now carries them too. The window's "leave this
  window open" lines are left out, and so is "press Enter".
- **stdout carries events**, one per line, `@tsundoku ` and JSON
  (`ops/release/launcher/tray.ts`):
  - `home`: the data folder and its logs, for OPEN THE LOGS FOLDER;
  - `ready`: the origin it opened (the menu's first item);
  - `already`: another tsundoku answered there. The launcher opens it and
    exits 0, and the tray quits, leaving that one alone (one started by
    `tsundoku.cmd`, for instance);
  - `stopped`: the app stopped by itself, with its log's path.
- **stdin carries commands**: `open` (open the browser now, or once the app
  answers, even after `--no-browser`) and `quit` (stop everything, as Ctrl+C
  does). **stdin closing also stops everything**: a tray that's killed (an
  update's installer stops every process run from the program's folder,
  in no particular order) takes the launcher with it, and nothing of tsundoku
  outlives the tray.

QUIT from the menu sends `quit`, closes stdin, and waits up to 20 s for the
launcher to stop. If it hasn't, it kills it (`taskkill /T /F`, or SIGTERM
then SIGKILL). The lock goes last, so `--quit` returns only once everything
has stopped.

The launcher writes its events, then exits only once stdout has passed them
on (`exit` in `launch.ts`): a pipe may be asynchronous, and an `already`
lost to an early exit would leave the tray showing "Starting..." for a
tsundoku that's someone else's.

### Logs

- `logs/launcher.log` in the data folder: the launcher's own lines, in tray
  mode.
- `logs/tray.log` in the **default** data folder: the tray's own (start,
  stop, the launcher's exit code, Node failing before the launcher could
  say anything), started over past 1 MB. With `TSUNDOKU_HOME` elsewhere it
  isn't beside the others, and SAVE A REPORT doesn't carry it.

## Tests

- `ops/release/tray/*_test.go` (`go test -race ./...` in that folder): the
  supervisor, against the test binary acting as a fake launcher through real
  pipes and exit codes (ready, already running, stopping by itself, never
  stopping), the lock, `tray.json` and the control calls, `--quit`, the
  default data folder per platform, the language, the log's restart. The
  systray glue (`ui.go`) and `main` are left to the smoke tests, which
  start the real program. Coverage is about half the package for that
  reason.
- `tests/launcher-tray.spec.ts`: the launcher's half of the protocol, and
  that both halves use the same prefix and commands.
- **Smoke, Linux** (`ops/release/smoke/linux-tray.sh`, after the foreground
  run in the same container): `./tsundoku` returns at once, tsundoku
  answers, the tray is in a session of its own, a second start (with a
  browser to open, and no `xdg-open`) finds it and starts no second server,
  `--quit` stops everything and removes `tray.json`, and `--quit` again says
  it isn't running.
- **Smoke, Windows** (`windows.ps1`): `tsundoku.exe` starts it, one tray,
  the launcher in tray mode, the probe, loopback only, a second start
  returns and starts nothing, `--quit` leaves nothing running, and
  `tsundoku.cmd` still works as before. The installer's stage checks the
  Start-menu entry's target is `tsundoku.exe`, and that `--quit` stops the
  installed copy. The updater's stage checks that one tray came back with
  the new version.

None of these can see a window: over SSH there's no desktop to show one on.
That the console never appears rests on the PE header check above.

On a real desktop, 2026-11-01:

- **Linux, the workstation (Hyprland, SekaiPop's Quickshell tray)**: the
  item registered with the StatusNotifierWatcher, its tooltip read
  `tsundoku: http://localhost:42191` (a scratch data folder and ports, beside
  the workstation's own tsundoku), its 64 px pixmap was there, and the menu
  as the host reads it (`com.canonical.dbusmenu` GetLayout) was the table
  above, START IT AGAIN hidden. QUIT, clicked through that menu over D-Bus,
  stopped everything and removed `tray.json`.
- **Windows: not yet seen.** Zen stops at its sign-in screen and the tests
  have no password for it, so the icon, its menu, a left click and the
  absence of a console flash on a real Windows desktop are for the owner to
  look at once (card c222).
