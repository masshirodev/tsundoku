tsundoku {{VERSION}}
====================

A reading library for manga, manhwa, comics and novels, and the episodes
you watch. It runs on this computer and you read it in your browser.


Starting it
-----------

Windows, installed:  Start menu > tsundoku
Windows, unzipped:   double-click tsundoku.exe
Linux:               run ./tsundoku

tsundoku runs in the background, with its icon by the clock, in the
tray. Your browser opens at http://localhost:42143 once it's ready. Use
that address, localhost, not 127.0.0.1. (To read on a phone or tablet
instead, see below.) On Linux, ./tsundoku gives the terminal back at once:
closing the terminal doesn't stop tsundoku.

Starting it again while it runs only opens your browser. Click the icon
to open tsundoku; its menu (right click) also opens the logs folder, and
"Quit tsundoku" stops it. On Windows the icon may hide behind the ^ arrow
by the clock: drag it out to keep it in sight.

No icon? Some Linux desktops have no tray (GNOME, without the
AppIndicator extension). tsundoku runs all the same: start it again to
open it, and run ./tsundoku --quit to stop it.

The old way, in a window that stops tsundoku when you close it, is still
there: tsundoku.cmd on Windows, ./tsundoku --foreground on Linux.

The installer puts tsundoku in %LOCALAPPDATA%\Programs\tsundoku without
asking for an administrator, and can start it when you sign in. Running a
newer installer updates it; Settings > Apps uninstalls it. Neither touches
your data (below).

The first time, tsundoku asks you to choose a password, or none. With
none, anyone using this computer opens your library; nothing else can
reach it. You can set, change or remove it later in SETTINGS > DEVICES.

Forgot it? Start menu > "Reset tsundoku password" (on Linux, run
./tsundoku --reset-password), then open tsundoku and choose a new one.
Your library isn't touched.

If tsundoku stops by itself, the icon stays, and its menu says so and
shows why; everything it wrote is in logs\tsundoku.log in your data
folder (below).

If something breaks: SETTINGS > LIBRARY > REPORT > SAVE, and send that
file to whoever gave you tsundoku. It has the logs and versions, never
anything you've hidden, your password or your tokens.

Windows may warn that the app is from an unknown publisher (it isn't
signed). Choose "More info", then "Run anyway". It may also ask whether
Java may use the network: it only listens on this computer, so you can
say no.


Your data
---------

Everything tsundoku keeps is in one folder, never in this one:

  Windows:  %LOCALAPPDATA%\tsundoku
  Linux:    ~/.local/share/tsundoku

library\   your files, as tsundoku arranges them
covers\    cover thumbnails
logs\      what tsundoku, the engine and FlareSolverr said, for when
           something breaks
.env       your settings
login.json your password, scrambled so it can't be read back

To keep your library somewhere else (another drive), add a line to the
.env in the folder above (create it if there isn't one):

  TSUNDOKU_HOME=D:\tsundoku

and move everything else there; that .env stays where it is, pointing the
way. Updating tsundoku never touches your data: unzip the new version over
or beside the old one.


Reading on your phone or tablet
-------------------------------

At home, the easy way: SETTINGS > DEVICES > WI-FI > ON, and scan the code
it shows with the phone's camera. The phone has to be on the same Wi-Fi.
The first time, Windows asks whether tsundoku may use the network: leave
"Private networks" ticked and choose Allow access. Over Wi-Fi the phone
reads, browses, searches and downloads, but can't keep chapters offline,
install tsundoku as an app or keep the screen awake. Switch it off on a
cafe's or a dorm's Wi-Fi: anyone on the same Wi-Fi reaches the sign-in page.

Everything, anywhere: Tailscale, a free private network between your own
devices (https://tailscale.com):

1. Install Tailscale on this computer and on the phone or tablet, and sign
   in to the same account on both. On Linux, also run this once, so
   tsundoku may set up Tailscale's HTTPS for you:

     sudo tailscale set --operator=$USER

   tsundoku also needs a password for this (SETTINGS > DEVICES), or anyone
   on your Tailscale could open it.
2. In Tailscale's admin console (login.tailscale.com), on the DNS page,
   turn on MagicDNS and HTTPS Certificates.
3. Add this line to the .env in your data folder (above):

     TSUNDOKU_SERVE=https

4. Quit tsundoku (its icon's menu) and start it again. It opens at an
   address like https://your-pc.your-tailnet.ts.net:8443, which the
   icon's menu shows: open that same address on the phone or tablet. On this computer too, use it
   rather than localhost from now on. The very first time, it can take a
   few seconds to load while Tailscale gets its certificate.

It's still private: only devices signed in to your Tailscale can reach it,
and only with your password. Take the line out of .env to go back.
If it doesn't open, look in logs\tsundoku.log (the icon's menu opens
the folder): if tsundoku couldn't set up "tailscale serve", the command
to run once yourself, in a terminal, is there.


Sources behind a browser check
------------------------------

Some sites show a "checking your browser" page first. Reading those needs
FlareSolverr, a separate download from the same place as this one
(flaresolverr-...zip, about 330 MB, since it carries its own Chrome). Unzip
it into your data folder (above), so there's a flaresolverr folder in it,
and quit and start tsundoku again. It stays there through updates and
reinstalls.


Sources that need a browser of their own
----------------------------------------

A few extensions run their site in a browser (a "WebView"): BROWSE marks
them NEEDS A WEBVIEW. tsundoku can give them one, a Chromium nobody sees,
but it's off unless you turn it on, in SETTINGS > BROWSE > WEBVIEW: that
Chromium is an old one (111) and runs those sites' scripts without a
sandbox. Turned on, it downloads once (about 180 MB) the first time such an
extension is used; REMOVE there deletes it again.

On Linux it also needs Xvfb, which gives it a screen nobody sees:

  sudo apt install xvfb        (Debian, Ubuntu)
  sudo dnf install xorg-x11-server-Xvfb   (Fedora)
  sudo pacman -S xorg-server-xvfb          (Arch)

Without it, SETTINGS > BROWSE > WEBVIEW says FAILED and what to install.
Nothing else in tsundoku needs it.


Updates
-------

tsundoku looks for a new version once a day (it asks
dl.tsundoku.masshiro.pro, which sees nothing but that request). When one is
out, the library says so; SETTINGS > DEVICES > UPDATES shows what's new.
On Windows, UPDATE downloads it, checks it was signed by tsundoku's
release key, and installs it: tsundoku closes for a minute and opens
again, your library untouched. On Linux, DOWNLOAD it and start the new
folder instead. To stop looking, add TSUNDOKU_UPDATES=off to .env.

The newest version is always at
https://dl.tsundoku.masshiro.pro/latest/tsundoku-win-x64.exe


Licences
--------

tsundoku is under the PolyForm Noncommercial License 1.0.0 (LICENSE):
use it, change it and share it freely, but don't sell it. Share LICENSE
with it. Everything else in this folder, and its
licence, is listed in THIRD-PARTY-NOTICES.txt. The extension engine is
MPL-2.0: ask whoever gave you this copy for its source and you'll get it.
