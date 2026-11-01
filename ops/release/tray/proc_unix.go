//go:build !windows

package main

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

func hide(*exec.Cmd) {}

// killTree is the last resort when the launcher doesn't stop: SIGTERM, which
// it answers by stopping its children's process groups, then SIGKILL.
func killTree(p *os.Process) {
	if p == nil {
		return
	}
	_ = p.Signal(syscall.SIGTERM)
	time.Sleep(5 * time.Second)
	_ = p.Kill()
}

func openPath(target string) error {
	c := exec.Command("xdg-open", target)
	c.Stdout, c.Stderr = nil, nil
	if err := c.Start(); err != nil {
		return err
	}
	go c.Wait()
	return nil
}

// detachedEnv marks the copy that detach starts, so it doesn't detach again.
const detachedEnv = "TSUNDOKU_TRAY_DETACHED"

// detach starts this tray again in a session of its own, with no terminal,
// and reports true: the caller then only says where it went and exits, so
// the terminal ./tsundoku was run from can close without stopping it. In the
// detached copy it reports false, and that copy carries on as the tray.
func detach(args []string) (bool, error) {
	if os.Getenv(detachedEnv) == "1" {
		return false, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return false, err
	}
	null, err := os.OpenFile(os.DevNull, os.O_RDWR, 0)
	if err != nil {
		return false, err
	}
	defer null.Close()
	c := exec.Command(exe, args...)
	c.Env = append(os.Environ(), detachedEnv+"=1")
	c.Stdin, c.Stdout, c.Stderr = null, null, null
	c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := c.Start(); err != nil {
		return false, err
	}
	return true, c.Process.Release()
}
