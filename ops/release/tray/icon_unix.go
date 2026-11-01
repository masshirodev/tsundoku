//go:build !windows

package main

import _ "embed"

// Linux's tray (StatusNotifierItem) takes a PNG and scales it itself.
//
//go:embed icon/tsundoku.png
var trayIcon []byte
