package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"testing"
)

// The test binary doubles as a fake launcher: run with FAKE_LAUNCHER set, it
// speaks the launcher's side of the protocol (tray.ts) and exits, so the
// supervisor is tested through a real process, pipes and exit codes.
func TestMain(m *testing.M) {
	if mode := os.Getenv("FAKE_LAUNCHER"); mode != "" {
		os.Exit(fakeLauncher(mode, os.Getenv("FAKE_RECORD")))
	}
	os.Exit(m.Run())
}

func fakeLauncher(mode, record string) int {
	emit := func(s string) { fmt.Printf("%s%s\n", eventPrefix, s) }
	note := func(s string) {
		if record == "" {
			return
		}
		f, _ := os.OpenFile(record, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		fmt.Fprintln(f, s)
		f.Close()
	}
	emit(`{"event":"home","home":"/h","logs":"/h/logs"}`)
	switch mode {
	case "already":
		emit(`{"event":"already","origin":"http://localhost:42143"}`)
		return 0
	case "crash":
		emit(`{"event":"ready","origin":"http://localhost:42143"}`)
		emit(`{"event":"stopped","code":3,"log":"/h/logs/tsundoku.log"}`)
		return 3
	case "stubborn":
		// Never answers QUIT, nor stdin closing.
		emit(`{"event":"ready","origin":"http://localhost:42143"}`)
		select {}
	}
	fmt.Println("an ordinary line, which the tray ignores")
	emit(`{"event":"ready","origin":"http://localhost:42143"}`)
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		note(sc.Text())
		if sc.Text() == cmdQuit {
			return 0
		}
	}
	note("eof")
	return 0
}

func fake(t *testing.T, mode, record string) func() *exec.Cmd {
	t.Helper()
	return func() *exec.Cmd {
		c := exec.Command(os.Args[0], "-test.run=^$")
		c.Env = append(os.Environ(), "FAKE_LAUNCHER="+mode, "FAKE_RECORD="+record)
		return c
	}
}
