package main

import "strings"

// The tray's words, in the computer's language: English, or Brazilian
// Portuguese, the app's two (doc/I18N.md). The app decides a device's
// language in its settings; the tray, which has no settings and starts
// before the app answers, follows the system's instead.
type Strings struct {
	Tooltip, Open, Logs, Again, Quit string
	Starting, Stopped                string
	Running                          func(origin string) string
}

var english = Strings{
	Tooltip:  "tsundoku",
	Open:     "Open tsundoku",
	Logs:     "Open the logs folder",
	Again:    "Start it again",
	Quit:     "Quit tsundoku",
	Starting: "Starting…",
	Stopped:  "It stopped by itself: show its log",
	Running:  func(o string) string { return "Running at " + o },
}

var portuguese = Strings{
	Tooltip:  "tsundoku",
	Open:     "Abrir o tsundoku",
	Logs:     "Abrir a pasta dos logs",
	Again:    "Iniciar de novo",
	Quit:     "Sair do tsundoku",
	Starting: "Iniciando…",
	Stopped:  "Parou sozinho: mostrar o log",
	Running:  func(o string) string { return "Rodando em " + o },
}

// stringsFor picks by the first language that's either of the two: `pt-BR`,
// `pt_BR.UTF-8` and any other Portuguese get Portuguese.
func stringsFor(languages []string) Strings {
	for _, l := range languages {
		l = strings.ToLower(l)
		if strings.HasPrefix(l, "pt") {
			return portuguese
		}
		if strings.HasPrefix(l, "en") {
			return english
		}
	}
	return english
}
