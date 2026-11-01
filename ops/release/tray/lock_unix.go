//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

// tryLock takes the one-tray-per-account lock, or says another tray has it.
// The kernel lets go of it when the process ends, however it ends, so a
// crashed tray never leaves a stale one behind (as a pid file would).
func tryLock(file string) (release func(), ok bool, err error) {
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return nil, false, err
	}
	f, err := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, unix.EWOULDBLOCK) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return func() { f.Close() }, true, nil
}
