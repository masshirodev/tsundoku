//go:build windows

package main

import (
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var findWindow = windows.NewLazySystemDLL("user32.dll").NewProc("FindWindowW")

// trayHost waits for the taskbar, whose notification area the icon goes in.
// At sign-in the Startup folder can run before Explorer has made it, and
// systray then fails to add the icon and never builds its menu, even once
// the taskbar comes: so wait for it first. A session with no taskbar at all
// (an SSH session, as the smoke test's) never has one, and the tray runs
// without an icon: tsundoku.exe --quit still stops it. Done ends the wait:
// a tray quit meanwhile mustn't hold the lock for the rest of the minute.
func trayHost(done <-chan struct{}) bool {
	class, _ := windows.UTF16PtrFromString("Shell_TrayWnd")
	for i := 0; i < 120; i++ {
		if h, _, _ := findWindow.Call(uintptr(unsafe.Pointer(class)), 0); h != 0 {
			return true
		}
		select {
		case <-done:
			return false
		case <-time.After(500 * time.Millisecond):
		}
	}
	return false
}
