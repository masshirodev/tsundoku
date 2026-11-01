package main

import (
	"log"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestQuitWhenNothingRuns(t *testing.T) {
	dir := t.TempDir()
	if code := quitRunning(filepath.Join(dir, controlFile), filepath.Join(dir, lockFile)); code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestQuitWaitsForTheLock(t *testing.T) {
	dir := t.TempDir()
	control, lock := filepath.Join(dir, controlFile), filepath.Join(dir, lockFile)
	release, ok, err := tryLock(lock)
	if !ok || err != nil {
		t.Fatal(ok, err)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	// The tray: QUIT lets go of the lock a moment later, as a real one does
	// once the launcher has stopped.
	srv := serveControl(ln, "tok", func(cmd string) {
		if cmd == cmdQuit {
			time.Sleep(300 * time.Millisecond)
			release()
		}
	})
	defer srv.Close()
	if err := writeControl(control, Control{Pid: 1, Port: ln.Addr().(*net.TCPAddr).Port, Token: "tok"}); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if code := quitRunning(control, lock); code != 0 {
		t.Fatalf("exit %d", code)
	}
	if time.Since(start) < 250*time.Millisecond {
		t.Fatal("--quit returned before the tray let go")
	}
}

func TestQuitWithATrayThatDoesntAnswer(t *testing.T) {
	dir := t.TempDir()
	control, lock := filepath.Join(dir, controlFile), filepath.Join(dir, lockFile)
	release, _, _ := tryLock(lock)
	defer release()
	// Its address, but nobody listening there.
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	_ = writeControl(control, Control{Pid: 1, Port: port, Token: "tok"})
	if code := quitRunning(control, lock); code != 1 {
		t.Fatalf("exit %d", code)
	}
}

func TestStartLogRotatesPastAMegabyte(t *testing.T) {
	file := filepath.Join(t.TempDir(), "logs", "tray.log")
	defer log.SetOutput(os.Stderr)
	closeLog := startLog(file)
	log.Printf("first")
	closeLog()
	if err := os.WriteFile(file, make([]byte, 1<<20+1), 0o600); err != nil {
		t.Fatal(err)
	}
	closeLog = startLog(file)
	log.Printf("second")
	closeLog()
	b, _ := os.ReadFile(file)
	if !strings.Contains(string(b), "second") || len(b) > 1000 {
		t.Fatalf("tray.log: %d bytes", len(b))
	}
	if st, err := os.Stat(file + ".1"); err != nil || st.Size() <= 1<<20 {
		t.Fatal("the old one should be tray.log.1")
	}
}
