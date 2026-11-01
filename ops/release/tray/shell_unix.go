//go:build !windows

package main

import "github.com/godbus/dbus/v5"

// trayHost says whether there's a session bus to put a StatusNotifierItem
// on. Without one (a container, a bare tty session) the tray runs without
// an icon, and ./tsundoku --quit stops it. With one but no tray on the
// desktop (GNOME without the AppIndicator extension), systray still exports
// the item and nobody shows it; the same --quit applies.
func trayHost(<-chan struct{}) bool {
	conn, err := dbus.SessionBus()
	if err != nil {
		return false
	}
	return conn.Connected()
}
