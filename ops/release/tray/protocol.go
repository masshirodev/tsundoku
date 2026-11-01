package main

import (
	"encoding/json"
	"strings"
)

// The launcher's side of this is ops/release/launcher/tray.ts: one event per
// line on its stdout, `@tsundoku ` and a JSON object; commands back on its
// stdin, one word a line (doc/TRAY.md, "Talking to the launcher").

const eventPrefix = "@tsundoku "

// Event is one of tray.ts's `TrayEvent`s; the fields not in its kind are empty.
type Event struct {
	Event  string `json:"event"`
	Home   string `json:"home,omitempty"`
	Logs   string `json:"logs,omitempty"`
	Origin string `json:"origin,omitempty"`
	Code   int    `json:"code,omitempty"`
	Log    string `json:"log,omitempty"`
}

// parseEvent reads one line of the launcher's stdout; ok is false for
// anything that isn't an event.
func parseEvent(line string) (Event, bool) {
	line = strings.TrimRight(line, "\r\n")
	if !strings.HasPrefix(line, eventPrefix) {
		return Event{}, false
	}
	var e Event
	if err := json.Unmarshal([]byte(line[len(eventPrefix):]), &e); err != nil || e.Event == "" {
		return Event{}, false
	}
	return e, true
}

const (
	cmdOpen = "open"
	cmdQuit = "quit"
)
