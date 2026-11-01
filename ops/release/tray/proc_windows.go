//go:build windows

package main

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

// createNoWindow gives the launcher a console with no window. Its children
// (the app, the engine, ffmpeg, taskkill) then share that hidden console
// instead of each opening one of their own.
const createNoWindow = 0x08000000

func hide(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// killTree is the last resort when the launcher doesn't stop: it and
// everything it started, as the launcher's own stop does for its children.
func killTree(p *os.Process) {
	if p == nil {
		return
	}
	kill := exec.Command("taskkill", "/pid", strconv.Itoa(p.Pid), "/T", "/F")
	hide(kill)
	_ = kill.Run()
}

// openPath opens a folder in Explorer, or a file in what opens its kind
// (Notepad, for a log). Not `cmd /c start`, which would flash a console.
// Explorer exits 1 whatever happens, so it's started, never waited for.
func openPath(target string) error {
	c := exec.Command("explorer.exe", target)
	if err := c.Start(); err != nil {
		return err
	}
	go c.Wait()
	return nil
}

// detach is for Linux, where ./tsundoku is run from a terminal. A Windows
// tsundoku.exe has no console to leave: it runs where it was started.
func detach([]string) (bool, error) { return false, nil }
