package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// A running tray answers on loopback, at the port and with the token it
// writes to tray.json in the default data folder. A second start asks it to
// OPEN instead of starting tsundoku twice; `--quit` asks it to QUIT. The
// token keeps another account on the same computer from quitting this one's
// (the file is the account's own).

const controlFile = "tray.json"
const lockFile = "tray.lock"
const tokenHeader = "X-Tsundoku-Tray"

type Control struct {
	Pid   int    `json:"pid"`
	Port  int    `json:"port"`
	Token string `json:"token"`
}

func newToken() string {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// writeControl replaces tray.json whole, so a reader never sees half of one.
func writeControl(file string, c Control) error {
	b, err := json.Marshal(c)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

func readControl(file string) (Control, error) {
	var c Control
	b, err := os.ReadFile(file)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	if c.Port <= 0 || c.Token == "" {
		return c, errors.New("tray.json has no address")
	}
	return c, nil
}

// serveControl answers POST /open and POST /quit with the token, calling on
// with the command. It returns at once; close the server to stop.
func serveControl(ln net.Listener, token string, on func(cmd string)) *http.Server {
	mux := http.NewServeMux()
	for _, cmd := range []string{cmdOpen, cmdQuit} {
		mux.HandleFunc("/"+cmd, func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "POST only", http.StatusMethodNotAllowed)
				return
			}
			if r.Header.Get(tokenHeader) != token {
				http.Error(w, "wrong token", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusAccepted)
			go on(cmd)
		})
	}
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go srv.Serve(ln)
	return srv
}

// send asks the tray at c to run cmd.
func send(c Control, cmd string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/%s", c.Port, cmd), nil)
	if err != nil {
		return err
	}
	req.Header.Set(tokenHeader, c.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		return fmt.Errorf("the tray answered %s", res.Status)
	}
	return nil
}
