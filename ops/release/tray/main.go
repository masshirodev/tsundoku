// The tsundoku tray (doc/TRAY.md): what a friend starts. It runs the
// launcher (launcher/launch.ts) with no window, puts an icon in the
// notification area with OPEN, the logs and QUIT, and keeps tsundoku to one
// copy per account: started again, it opens the running one instead.
//
//	tsundoku.exe              Windows: start it, or open it if it's running
//	./tsundoku                Linux: the same, in the background
//	... --no-browser          start without opening the browser (sign-in, updates)
//	... --quit                stop the running one, and wait until it has
package main

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"time"
)

var version = "dev"

func main() {
	args := os.Args[1:]
	home := defaultHome(runtime.GOOS, os.Getenv, userHome())
	control := filepath.Join(home, controlFile)
	lock := filepath.Join(home, lockFile)
	noBrowser := slices.Contains(args, "--no-browser") || os.Getenv("TSUNDOKU_NO_BROWSER") == "1"

	if slices.Contains(args, "--quit") {
		os.Exit(quitRunning(control, lock))
	}

	// A tray already runs: it opens tsundoku, and this start is done. With
	// --no-browser (start at sign-in, an update's relaunch) there's nothing to
	// ask it. A tray.json whose tray doesn't answer is left from one that
	// died, and this start takes its place.
	if c, err := readControl(control); err == nil {
		if noBrowser {
			if release, ok, _ := tryLock(lock); !ok {
				say("tsundoku is already running.")
				return
			} else if release != nil {
				release()
			}
		} else if send(c, cmdOpen, 3*time.Second) == nil {
			say("tsundoku is already running: opening it.")
			return
		}
	}

	if gone, err := detach(args); err != nil {
		say("tsundoku couldn't start in the background: %v", err)
		os.Exit(1)
	} else if gone {
		say("tsundoku is starting in the background; it opens in your browser once it's ready.")
		say("Quit it from its icon in the tray, or with: ./tsundoku --quit")
		return
	}

	closeLog := startLog(filepath.Join(home, "logs", "tray.log"))
	defer closeLog()
	log.Printf("--- tsundoku tray %s, pid %d", version, os.Getpid())

	release, ok, err := tryLock(lock)
	if err != nil {
		log.Fatalf("couldn't take %s: %v", lock, err)
	}
	if !ok {
		// Another tray started a moment before this one and hasn't written
		// its address yet: wait for it, and ask it to open.
		log.Printf("another tray holds the lock; asking it to open")
		if noBrowser {
			return
		}
		for i := 0; i < 30; i++ {
			if c, err := readControl(control); err == nil && send(c, cmdOpen, 3*time.Second) == nil {
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
		log.Fatalf("another tray holds the lock but doesn't answer")
	}
	defer release()

	exe, err := os.Executable()
	if err != nil {
		log.Fatalf("where am I: %v", err)
	}
	root := bundleRoot(exe, func(f string) bool { _, err := os.Stat(f); return err == nil })
	node, nodeArgs := launcherArgs(root, runtime.GOOS, noBrowser)
	sup := newSupervisor(func() *exec.Cmd {
		c := exec.Command(node, nodeArgs...)
		c.Dir = root
		hide(c)
		return c
	}, nil)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("couldn't listen on loopback: %v", err)
	}
	token := newToken()
	quit := func() {
		sup.Quit()
	}
	srv := serveControl(ln, token, func(cmd string) {
		switch cmd {
		case cmdOpen:
			sup.Open()
		case cmdQuit:
			quit()
		}
	})
	defer srv.Close()
	if err := writeControl(control, Control{Pid: os.Getpid(), Port: ln.Addr().(*net.TCPAddr).Port, Token: token}); err != nil {
		log.Fatalf("couldn't write %s: %v", control, err)
	}
	defer os.Remove(control)

	if err := sup.Start(false); err != nil {
		log.Printf("couldn't start the launcher: %v", err)
	}
	runUI(sup, stringsFor(systemLanguages()), quit)
	// The menu is gone (QUIT, or the launcher handed over to another
	// tsundoku): make sure the launcher is too before letting go of the lock.
	sup.Quit()
	log.Printf("--- the tray stopped")
}

// quitRunning is --quit: ask the running tray to stop, and wait until its
// lock is free, which is when it and everything it started are gone.
func quitRunning(control, lock string) int {
	c, err := readControl(control)
	if err != nil || send(c, cmdQuit, 3*time.Second) != nil {
		if release, ok, _ := tryLock(lock); ok {
			release()
			say("tsundoku isn't running.")
			return 0
		}
		say("tsundoku is running but its tray doesn't answer.")
		return 1
	}
	for i := 0; i < 60; i++ {
		if release, ok, _ := tryLock(lock); ok {
			release()
			say("tsundoku has stopped.")
			return 0
		}
		time.Sleep(500 * time.Millisecond)
	}
	say("tsundoku is still stopping after 30 seconds.")
	return 1
}

// say is for a person at a terminal (Linux); tsundoku.exe has no console,
// and Windows drops it.
func say(format string, a ...any) {
	fmt.Fprintf(os.Stdout, format+"\n", a...)
}

func userHome() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return h
}

// startLog sends this tray's own lines (and systray's) to logs/tray.log,
// started over once it passes 1 MB: it says little, and only about the tray.
func startLog(file string) func() {
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return func() {}
	}
	if st, err := os.Stat(file); err == nil && st.Size() > 1<<20 {
		_ = os.Rename(file, file+".1")
	}
	f, err := os.OpenFile(file, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return func() {}
	}
	log.SetOutput(io.MultiWriter(f))
	log.SetFlags(log.LstdFlags | log.LUTC)
	return func() { f.Close() }
}
