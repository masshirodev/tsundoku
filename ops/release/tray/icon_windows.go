//go:build windows

package main

import _ "embed"

// Windows' tray takes an .ico; this is the installer's (installer/icon.sh).
//
//go:embed icon/tsundoku.ico
var trayIcon []byte
