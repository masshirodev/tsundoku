package main

import (
	"path/filepath"
	"strings"
)

// defaultHome is tsundoku's data folder when TSUNDOKU_HOME is unset, as
// `defaultHome` in src/lib/server/data-dirs.ts says it: the tray keeps its
// lock and its address there. Not the folder TSUNDOKU_HOME may move the
// library to: the launcher reads that from this folder's .env, and one tray
// per account is the rule whichever folder the library is in.
//
// goos is passed rather than read so a test can ask for Windows' answer on
// Linux; the separators are the target's.
func defaultHome(goos string, getenv func(string) string, userHome string) string {
	switch goos {
	case "windows":
		base := getenv("LOCALAPPDATA")
		if base == "" {
			base = winJoin(userHome, "AppData", "Local")
		}
		return winJoin(base, "tsundoku")
	case "darwin":
		return filepath.Join(userHome, "Library", "Application Support", "tsundoku")
	default:
		base := getenv("XDG_DATA_HOME")
		if base == "" {
			base = filepath.Join(userHome, ".local", "share")
		}
		return filepath.Join(base, "tsundoku")
	}
}

func winJoin(parts ...string) string {
	for i, p := range parts {
		if i > 0 {
			p = strings.Trim(p, `\/`)
		} else {
			p = strings.TrimRight(p, `\/`)
		}
		parts[i] = p
	}
	return strings.Join(parts, `\`)
}

// bundleRoot is the release bundle's folder, the one holding launcher/launch.ts.
// tsundoku.exe sits in it on Windows; on Linux the tray is
// launcher/tsundoku-tray, one folder down.
func bundleRoot(exe string, exists func(string) bool) string {
	dir := filepath.Dir(exe)
	for _, d := range []string{dir, filepath.Dir(dir)} {
		if exists(filepath.Join(d, "launcher", "launch.ts")) {
			return d
		}
	}
	return dir
}

// launcherArgs is what runs the launcher for the tray: the bundle's own Node,
// launch.ts in tray mode, and --no-browser when the tray was given it (start
// at sign-in, an update's relaunch).
func launcherArgs(root, goos string, noBrowser bool) (string, []string) {
	node := filepath.Join(root, "node", "bin", "node")
	if goos == "windows" {
		node = filepath.Join(root, "node", "node.exe")
	}
	args := []string{
		"--disable-warning=ExperimentalWarning",
		filepath.Join(root, "launcher", "launch.ts"),
		"--tray",
	}
	if noBrowser {
		args = append(args, "--no-browser")
	}
	return node, args
}
