//go:build windows

package main

import "golang.org/x/sys/windows"

func systemLanguages() []string {
	l, err := windows.GetUserPreferredUILanguages(windows.MUI_LANGUAGE_NAME)
	if err != nil {
		return nil
	}
	return l
}
