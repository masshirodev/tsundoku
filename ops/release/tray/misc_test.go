package main

import (
	"net"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestDefaultHomeMatchesTheApp(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	cases := []struct {
		goos, want string
		env        map[string]string
		home       string
	}{
		{"windows", `C:\Users\Ami\AppData\Local\tsundoku`, map[string]string{"LOCALAPPDATA": `C:\Users\Ami\AppData\Local`}, `C:\Users\Ami`},
		{"windows", `C:\Users\Ami\AppData\Local\tsundoku`, map[string]string{}, `C:\Users\Ami`},
		{"linux", "/home/ami/.local/share/tsundoku", map[string]string{}, "/home/ami"},
		{"linux", "/data/tsundoku", map[string]string{"XDG_DATA_HOME": "/data"}, "/home/ami"},
		{"darwin", "/Users/ami/Library/Application Support/tsundoku", map[string]string{}, "/Users/ami"},
	}
	for _, c := range cases {
		if got := defaultHome(c.goos, env(c.env), c.home); got != c.want {
			t.Errorf("%s %v: %q, want %q", c.goos, c.env, got, c.want)
		}
	}
}

func TestBundleRoot(t *testing.T) {
	has := func(files ...string) func(string) bool {
		return func(f string) bool { return slices.Contains(files, f) }
	}
	// Linux: launcher/tsundoku-tray, one folder down.
	if got := bundleRoot("/b/tsundoku/launcher/tsundoku-tray", has("/b/tsundoku/launcher/launch.ts")); got != "/b/tsundoku" {
		t.Errorf("linux: %s", got)
	}
	// Windows: tsundoku.exe beside launcher/.
	if got := bundleRoot("/b/tsundoku/tsundoku.exe", has("/b/tsundoku/launcher/launch.ts")); got != "/b/tsundoku" {
		t.Errorf("windows: %s", got)
	}
	if got := bundleRoot("/x/y", has()); got != "/x" {
		t.Errorf("none: %s", got)
	}
}

func TestLauncherArgs(t *testing.T) {
	node, args := launcherArgs("/b", "linux", true)
	if node != filepath.Join("/b", "node", "bin", "node") || !slices.Equal(args, []string{
		"--disable-warning=ExperimentalWarning", filepath.Join("/b", "launcher", "launch.ts"), "--tray", "--no-browser",
	}) {
		t.Errorf("%s %v", node, args)
	}
	node, args = launcherArgs("/b", "windows", false)
	if node != filepath.Join("/b", "node", "node.exe") || slices.Contains(args, "--no-browser") {
		t.Errorf("%s %v", node, args)
	}
}

// The same line tray.ts's eventLine writes (tests/launcher-tray.spec.ts has its twin).
func TestParseEvent(t *testing.T) {
	e, ok := parseEvent(`@tsundoku {"event":"ready","origin":"http://localhost:42143"}` + "\r\n")
	if !ok || e.Event != "ready" || e.Origin != "http://localhost:42143" {
		t.Errorf("%+v %v", e, ok)
	}
	e, ok = parseEvent(`@tsundoku {"event":"stopped","code":3,"log":"/h/logs/tsundoku.log"}`)
	if !ok || e.Code != 3 || e.Log != "/h/logs/tsundoku.log" {
		t.Errorf("%+v", e)
	}
	for _, l := range []string{"tsundoku 2026.11.01", "@tsundoku not json", `@tsundoku {"origin":"x"}`, ""} {
		if _, ok := parseEvent(l); ok {
			t.Errorf("%q parsed", l)
		}
	}
}

func TestControlRoundTrip(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "sub", controlFile)
	if _, err := readControl(file); err == nil {
		t.Fatal("no file should be an error")
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan string, 2)
	srv := serveControl(ln, "secret", func(cmd string) { got <- cmd })
	defer srv.Close()
	c := Control{Pid: os.Getpid(), Port: ln.Addr().(*net.TCPAddr).Port, Token: "secret"}
	if err := writeControl(file, c); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(file); st.Mode().Perm() != 0o600 {
		t.Errorf("tray.json is %v, want 0600", st.Mode().Perm())
	}
	back, err := readControl(file)
	if err != nil || back != c {
		t.Fatalf("%+v %v", back, err)
	}
	for _, cmd := range []string{cmdOpen, cmdQuit} {
		if err := send(back, cmd, time.Second); err != nil {
			t.Fatal(err)
		}
		if g := <-got; g != cmd {
			t.Errorf("got %s, want %s", g, cmd)
		}
	}
	if err := send(Control{Port: c.Port, Token: "wrong"}, cmdQuit, time.Second); err == nil {
		t.Error("a wrong token must be refused")
	}
	if err := os.WriteFile(file, []byte(`{"pid":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readControl(file); err == nil {
		t.Error("a tray.json with no address is no tray")
	}
}

func TestOneLockAtATime(t *testing.T) {
	file := filepath.Join(t.TempDir(), lockFile)
	release, ok, err := tryLock(file)
	if err != nil || !ok {
		t.Fatalf("%v %v", ok, err)
	}
	if _, ok, err := tryLock(file); ok || err != nil {
		t.Fatalf("a second lock: %v %v", ok, err)
	}
	release()
	again, ok, err := tryLock(file)
	if err != nil || !ok {
		t.Fatalf("after release: %v %v", ok, err)
	}
	again()
}

func TestStringsFor(t *testing.T) {
	for langs, want := range map[string]Strings{"pt-BR": portuguese, "pt_BR.UTF-8": portuguese, "en-US": english, "C": english, "": english} {
		if got := stringsFor([]string{langs}); got.Open != want.Open {
			t.Errorf("%q: %s", langs, got.Open)
		}
	}
	if got := stringsFor([]string{"ja-JP", "pt-PT"}); got.Open != portuguese.Open {
		t.Error("the first known language wins")
	}
	if english.Running("x") != "Running at x" || portuguese.Running("x") != "Rodando em x" {
		t.Error("Running")
	}
}
