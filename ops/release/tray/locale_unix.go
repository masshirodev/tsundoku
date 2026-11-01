//go:build !windows

package main

import (
	"os"
	"strings"
)

// As gettext reads them: LANGUAGE (a list), then LC_ALL, LC_MESSAGES, LANG.
// "C" and "POSIX" say nothing, so they fall through to English.
func systemLanguages() []string {
	var out []string
	if l := os.Getenv("LANGUAGE"); l != "" {
		out = append(out, strings.Split(l, ":")...)
	}
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if l := os.Getenv(k); l != "" {
			out = append(out, l)
		}
	}
	return out
}
