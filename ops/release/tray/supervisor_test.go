package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if ok() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func recorded(file string) []string {
	b, _ := os.ReadFile(file)
	return strings.Fields(string(b))
}

func TestRunningOpensAndQuits(t *testing.T) {
	rec := filepath.Join(t.TempDir(), "rec")
	s := newSupervisor(fake(t, "ready", rec), nil)
	if err := s.Start(false); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "ready", func() bool { return s.Status().Phase == Running })
	if st := s.Status(); st.Origin != "http://localhost:42143" || st.Logs != "/h/logs" {
		t.Fatalf("status %+v", st)
	}
	s.Open()
	waitFor(t, "open to reach the launcher", func() bool { return len(recorded(rec)) == 1 })
	s.Quit()
	select {
	case <-s.Done():
	default:
		t.Fatal("Done isn't closed after Quit")
	}
	if got := recorded(rec); strings.Join(got, ",") != "open,quit" {
		t.Fatalf("the launcher was told %v", got)
	}
	if s.Status().Phase != Quitting {
		t.Fatalf("phase %v", s.Status().Phase)
	}
}

func TestOpenAtStartIsSentAtOnce(t *testing.T) {
	rec := filepath.Join(t.TempDir(), "rec")
	s := newSupervisor(fake(t, "ready", rec), nil)
	if err := s.Start(true); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "open", func() bool { return len(recorded(rec)) == 1 && recorded(rec)[0] == "open" })
	s.Quit()
}

func TestAlreadyRunningHandsOver(t *testing.T) {
	s := newSupervisor(fake(t, "already", ""), nil)
	if err := s.Start(false); err != nil {
		t.Fatal(err)
	}
	select {
	case <-s.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the tray should finish when another tsundoku answered")
	}
}

func TestStoppedByItselfThenStartedAgain(t *testing.T) {
	var mu sync.Mutex
	var seen []Phase
	s := newSupervisor(fake(t, "crash", ""), nil)
	s.OnStatus(func(st Status) { mu.Lock(); seen = append(seen, st.Phase); mu.Unlock() })
	if err := s.Start(false); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "stopped", func() bool { return s.Status().Phase == Stopped })
	if st := s.Status(); st.AppLog != "/h/logs/tsundoku.log" || st.Origin != "" {
		t.Fatalf("status %+v", st)
	}
	select {
	case <-s.Done():
		t.Fatal("a crash must keep the tray, to say so")
	default:
	}
	// OPEN on a stopped tsundoku starts it again.
	rec := filepath.Join(t.TempDir(), "rec")
	s.command = fake(t, "ready", rec)
	s.Open()
	waitFor(t, "running again", func() bool { return s.Status().Phase == Running })
	waitFor(t, "the open that started it", func() bool { return len(recorded(rec)) == 1 })
	s.Quit()
	mu.Lock()
	defer mu.Unlock()
	// Told the status at once (Starting, nothing run yet), then each change.
	if seen[0] != Starting || seen[len(seen)-1] != Quitting {
		t.Fatalf("phases %v", seen)
	}
}

func TestQuitWhenStoppedFinishes(t *testing.T) {
	s := newSupervisor(fake(t, "crash", ""), nil)
	_ = s.Start(false)
	waitFor(t, "stopped", func() bool { return s.Status().Phase == Stopped })
	s.Quit()
	<-s.Done()
	s.Quit() // twice is fine
}

func TestQuitKillsALauncherThatWontStop(t *testing.T) {
	s := newSupervisor(fake(t, "stubborn", ""), nil)
	s.quitWait = 200 * time.Millisecond
	_ = s.Start(false)
	waitFor(t, "ready", func() bool { return s.Status().Phase == Running })
	start := time.Now()
	s.Quit()
	<-s.Done()
	if time.Since(start) > 10*time.Second {
		t.Fatal("too slow")
	}
}

func TestStartFailing(t *testing.T) {
	s := newSupervisor(func() *exec.Cmd { return exec.Command(filepath.Join(t.TempDir(), "no-such-node")) }, nil)
	if err := s.Start(false); err == nil {
		t.Fatal("want an error")
	}
	if s.Status().Phase != Stopped {
		t.Fatalf("phase %v", s.Status().Phase)
	}
}
