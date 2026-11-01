package main

import (
	"bufio"
	"io"
	"log"
	"os/exec"
	"sync"
	"time"
)

// The launcher, from the tray's side: started, watched through its events,
// told to OPEN and QUIT on its stdin, and started again from the menu after
// it stopped by itself. The launcher already restarts the engine and
// FlareSolverr; the tray never restarts the app on its own, since an app
// that stops at once would only stop again (the menu says so instead).

type Phase int

const (
	Starting Phase = iota
	Running
	Stopped
	Quitting
)

// Status is what the menu shows.
type Status struct {
	Phase  Phase
	Origin string // where the app answers, once Running
	Logs   string // the data folder's logs/, once the launcher said
	AppLog string // logs/tsundoku.log, for a Stopped app
}

type Supervisor struct {
	// command makes the launcher's command, fresh for each start.
	command func() *exec.Cmd
	// onStatus is told every change, from any goroutine.
	onStatus func(Status)
	// quitWait is how long QUIT waits for the launcher before killing it.
	quitWait time.Duration

	mu      sync.Mutex
	notify  sync.Mutex // one onStatus call at a time (tell)
	status  Status
	stdin   io.WriteCloser
	cmd     *exec.Cmd
	exited  chan struct{}
	wanted  bool // an OPEN to send once a launcher is there
	already bool // the launcher found tsundoku already running, and left
	done    chan struct{}
	once    sync.Once
}

func newSupervisor(command func() *exec.Cmd, onStatus func(Status)) *Supervisor {
	return &Supervisor{command: command, onStatus: onStatus, quitWait: 20 * time.Second, done: make(chan struct{})}
}

// Done is closed once there's nothing left for the tray to do: QUIT finished,
// or the launcher found another tsundoku running and handed over to it.
func (s *Supervisor) Done() <-chan struct{} { return s.done }

func (s *Supervisor) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *Supervisor) set(f func(*Status)) {
	s.mu.Lock()
	f(&s.status)
	s.mu.Unlock()
	s.tell()
}

// tell passes on the status as it is now, one call at a time: changes come
// from several goroutines, and the menu must end on the latest, not on
// whichever call happened to run last.
func (s *Supervisor) tell() {
	s.notify.Lock()
	defer s.notify.Unlock()
	s.mu.Lock()
	st, on := s.status, s.onStatus
	s.mu.Unlock()
	if on != nil {
		on(st)
	}
}

// OnStatus sets what's told every change, and tells it the current status.
// The menu calls it once it exists, which may be after the launcher started.
func (s *Supervisor) OnStatus(f func(Status)) {
	s.mu.Lock()
	s.onStatus = f
	s.mu.Unlock()
	s.tell()
}

// Start runs the launcher; open asks it to open the browser once the app
// answers, whatever --no-browser said.
func (s *Supervisor) Start(open bool) error {
	cmd := s.command()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	// The launcher's own lines go to logs/launcher.log; what comes here is
	// Node itself failing before the launcher could say anything.
	cmd.Stderr = log.Writer()
	s.set(func(st *Status) { st.Phase, st.Origin, st.AppLog = Starting, "", "" })
	if err := cmd.Start(); err != nil {
		s.set(func(st *Status) { st.Phase = Stopped })
		return err
	}
	exited := make(chan struct{})
	s.mu.Lock()
	s.cmd, s.stdin, s.exited = cmd, stdin, exited
	if open {
		s.wanted = true
	}
	wanted := s.wanted
	s.wanted = false
	s.mu.Unlock()
	if wanted {
		s.write(cmdOpen)
	}

	read := make(chan struct{})
	go func() {
		defer close(read)
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			if e, ok := parseEvent(sc.Text()); ok {
				s.event(e)
			}
		}
	}()
	go func() {
		<-read
		err := cmd.Wait()
		code := 0
		if err != nil {
			code = -1
			if x, ok := err.(*exec.ExitError); ok {
				code = x.ExitCode()
			}
		}
		log.Printf("the launcher stopped (%d)", code)
		close(exited)
		s.exit(code)
	}()
	return nil
}

func (s *Supervisor) event(e Event) {
	switch e.Event {
	case "home":
		s.set(func(st *Status) { st.Logs = e.Logs })
	case "ready":
		s.set(func(st *Status) { st.Phase, st.Origin = Running, e.Origin })
	case "already":
		s.mu.Lock()
		s.already = true
		s.mu.Unlock()
	case "stopped":
		s.set(func(st *Status) { st.AppLog = e.Log })
	}
}

func (s *Supervisor) exit(code int) {
	s.mu.Lock()
	quitting := s.status.Phase == Quitting
	already := s.already
	s.cmd, s.stdin = nil, nil
	s.mu.Unlock()
	if quitting || (already && code == 0) {
		s.finish()
		return
	}
	s.set(func(st *Status) { st.Phase, st.Origin = Stopped, "" })
}

func (s *Supervisor) finish() { s.once.Do(func() { close(s.done) }) }

func (s *Supervisor) write(cmd string) {
	s.mu.Lock()
	w := s.stdin
	s.mu.Unlock()
	if w != nil {
		if _, err := io.WriteString(w, cmd+"\n"); err != nil {
			log.Printf("couldn't tell the launcher %q: %v", cmd, err)
		}
	}
}

// Open opens tsundoku in the browser: now if the app answers, once it does if
// it's starting, and after starting it again if it had stopped.
func (s *Supervisor) Open() {
	switch s.Status().Phase {
	case Starting, Running:
		s.write(cmdOpen)
	case Stopped:
		if err := s.Start(true); err != nil {
			log.Printf("couldn't start the launcher: %v", err)
		}
	}
}

// Quit stops tsundoku and returns once the launcher has, killing it if it
// takes longer than quitWait. Done is closed after.
func (s *Supervisor) Quit() {
	s.mu.Lock()
	if s.status.Phase == Quitting {
		s.mu.Unlock()
		<-s.done
		return
	}
	cmd, stdin, exited := s.cmd, s.stdin, s.exited
	s.mu.Unlock()
	s.set(func(st *Status) { st.Phase = Quitting })
	if cmd == nil {
		s.finish()
		return
	}
	s.write(cmdQuit)
	// Closing stdin is the launcher's other cue to stop, should the line be lost.
	stdin.Close()
	select {
	case <-exited:
	case <-time.After(s.quitWait):
		log.Printf("the launcher didn't stop in %s; killing it", s.quitWait)
		killTree(cmd.Process)
		<-exited
	}
	s.finish()
}
