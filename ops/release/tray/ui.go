package main

import (
	"log"
	"path/filepath"

	"fyne.io/systray"
)

// runUI shows the tray icon and its menu, and blocks until the supervisor
// is done (QUIT, or the launcher handed over to a tsundoku already running).
// With nowhere to show an icon (trayHost) it only waits: tsundoku still
// runs, and `--quit` stops it.
func runUI(s *Supervisor, t Strings, quit func()) {
	if !trayHost(s.Done()) {
		log.Printf("no tray on this desktop: running without an icon (--quit stops it)")
		<-s.Done()
		return
	}
	go func() {
		<-s.Done()
		systray.Quit()
	}()
	systray.Run(func() {
		systray.SetIcon(trayIcon)
		systray.SetTitle(t.Tooltip)
		systray.SetTooltip(t.Tooltip)

		status := systray.AddMenuItem(t.Starting, "")
		status.Disable()
		systray.AddSeparator()
		open := systray.AddMenuItem(t.Open, "")
		logs := systray.AddMenuItem(t.Logs, "")
		again := systray.AddMenuItem(t.Again, "")
		again.Hide()
		systray.AddSeparator()
		leave := systray.AddMenuItem(t.Quit, "")

		// A click on the icon itself opens tsundoku; the menu is the other button.
		systray.SetOnTapped(s.Open)

		show := func(st Status) {
			switch st.Phase {
			case Starting:
				status.SetTitle(t.Starting)
				status.Disable()
				again.Hide()
				systray.SetTooltip(t.Tooltip + ": " + t.Starting)
			case Running:
				status.SetTitle(t.Running(st.Origin))
				status.Disable()
				again.Hide()
				systray.SetTooltip(t.Tooltip + ": " + st.Origin)
			case Stopped:
				status.SetTitle(t.Stopped)
				status.Enable()
				again.Show()
				systray.SetTooltip(t.Tooltip + ": " + t.Stopped)
			}
		}
		s.OnStatus(show)

		go func() {
			for {
				select {
				case <-open.ClickedCh:
					s.Open()
				case <-logs.ClickedCh:
					if dir := s.Status().Logs; dir != "" {
						if err := openPath(dir); err != nil {
							log.Printf("couldn't open %s: %v", dir, err)
						}
					}
				case <-status.ClickedCh:
					st := s.Status()
					file := st.AppLog
					if file == "" && st.Logs != "" {
						file = filepath.Join(st.Logs, "tsundoku.log")
					}
					if file != "" {
						if err := openPath(file); err != nil {
							log.Printf("couldn't open %s: %v", file, err)
						}
					}
				case <-again.ClickedCh:
					s.Open()
				case <-leave.ClickedCh:
					leave.Disable()
					go quit()
				}
			}
		}()
	}, nil)
}
