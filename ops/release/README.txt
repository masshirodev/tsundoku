tsundoku {{VERSION}}
====================

A reading library for manga, manhwa, comics and novels, and the episodes
you watch. It runs on this computer and you read it in your browser.


Starting it
-----------

Windows:  double-click tsundoku.cmd
Linux:    run ./tsundoku

A window opens and stays open while tsundoku runs; closing it stops
tsundoku. Your browser opens at http://localhost:42143 once it's ready.
Use that address, localhost, not 127.0.0.1.

The first time, the window prints your sign-in token. Copy it into the
sign-in page. It's kept in your data folder (below), in the file .env,
if you need it again.

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
logs\      what the engine and FlareSolverr said, for when something breaks
.env       your settings and tokens

To keep your library somewhere else (another drive), add a line to the
.env in the folder above (create it if there isn't one):

  TSUNDOKU_HOME=D:\tsundoku

and move everything else there; that .env stays where it is, pointing the
way. Updating tsundoku never touches your data: unzip the new version over
or beside the old one.


Sources behind a browser check
------------------------------

Some sites show a "checking your browser" page first. Reading those needs
FlareSolverr, a separate download from the same place as this one
(flaresolverr-...zip, about 330 MB, since it carries its own Chrome). Unzip
it into this folder, so there's a flaresolverr folder beside tsundoku.cmd,
and start tsundoku again.


Licences
--------

tsundoku is MIT (LICENSE). Everything else in this folder, and its
licence, is listed in THIRD-PARTY-NOTICES.txt. The extension engine is
MPL-2.0: ask whoever gave you this copy for its source and you'll get it.
