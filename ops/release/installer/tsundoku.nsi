; tsundoku's Windows installer (doc/RELEASE.md, "The installer"; card c179).
; Built on Linux by ops/release/release.ts with NSIS's own makensis:
;
;   makensis -DVERSION=2026.10.29 -DVIVERSION=2026.10.29.0 \
;     -DBUNDLE=<the win-x64 bundle's folder> -DOUTFILE=<setup.exe> tsundoku.nsi
;
; Per user, like VS Code's user installer: into %LOCALAPPDATA%\Programs, with
; no administrator prompt, a Start-menu entry, an optional start at sign-in,
; and an uninstaller in Settings > Apps. It never touches the data folder
; (%LOCALAPPDATA%\tsundoku): uninstalling keeps the library, and so does an
; update, which is this installer run again.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"

!ifndef VERSION | VIVERSION | BUNDLE | OUTFILE | LICENSE
	!error "VERSION, VIVERSION, BUNDLE, OUTFILE and LICENSE are passed by release.ts"
!endif

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\tsundoku"

Name "tsundoku"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\tsundoku"
InstallDirRegKey HKCU "Software\tsundoku" "InstallDir"
BrandingText "tsundoku ${VERSION}"

VIProductVersion "${VIVERSION}"
VIAddVersionKey "ProductName" "tsundoku"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "tsundoku installer"
VIAddVersionKey "LegalCopyright" "masshirodev, PolyForm Noncommercial 1.0.0"

!define MUI_ICON "tsundoku.ico"
!define MUI_UNICON "tsundoku.ico"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_NODESC

!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start tsundoku"
!define MUI_FINISHPAGE_RUN_FUNCTION StartNow
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the README"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
; A CRLF copy of LICENSE: the page's text box shows LF-only text as one line.
!insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; A tsundoku started from this folder holds its files open (node.exe, java.exe,
; FlareSolverr's Chrome): stop it before replacing or removing them. Only
; processes run from this folder; anything else is left alone. Through WMI,
; not Get-Process: the installer is 32-bit, so `powershell` here is the 32-bit
; one, and its Get-Process can't read a 64-bit process's path, so it matched
; nothing (seen on Zen, 2026-10-29). Twice, a second apart, in case the
; launcher restarted a helper in between.
!define STOP_RUNNING `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
!macro StopRunning
	DetailPrint "Stopping tsundoku if it's running..."
	nsExec::Exec `${STOP_RUNNING}`
	Pop $0
	Sleep 1000
	nsExec::Exec `${STOP_RUNNING}`
	Pop $0
	Sleep 500
!macroend

; What tsundoku puts in its folder, by name. Removed by name, never the folder
; whole: the directory page lets a friend pick any folder, and an uninstaller
; that deletes "$INSTDIR" recursively deletes whatever else was in it.
!macro RemoveProgram
	RMDir /r "$INSTDIR\app"
	RMDir /r "$INSTDIR\node"
	RMDir /r "$INSTDIR\jre"
	RMDir /r "$INSTDIR\engine"
	RMDir /r "$INSTDIR\ffmpeg"
	RMDir /r "$INSTDIR\launcher"
	Delete "$INSTDIR\tsundoku.cmd"
	Delete "$INSTDIR\tsundoku.ico"
	Delete "$INSTDIR\LICENSE"
	Delete "$INSTDIR\README.txt"
	Delete "$INSTDIR\release.json"
	Delete "$INSTDIR\THIRD-PARTY-NOTICES.txt"
!macroend

Section "tsundoku" SecMain
	SectionIn RO
	!insertmacro StopRunning
	; An update replaces the program whole, so nothing of the old version
	; lingers. A FlareSolverr unzipped beside it stays.
	!insertmacro RemoveProgram

	SetOutPath "$INSTDIR"
	File /r "${BUNDLE}\*"
	File "tsundoku.ico"
	WriteUninstaller "$INSTDIR\uninstall.exe"

	CreateShortcut "$SMPROGRAMS\tsundoku.lnk" "$INSTDIR\tsundoku.cmd" "" "$INSTDIR\tsundoku.ico" 0

	WriteRegStr HKCU "Software\tsundoku" "InstallDir" "$INSTDIR"
	WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "tsundoku"
	WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
	WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "masshirodev"
	WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\tsundoku.ico"
	WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
	WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
	WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
	WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
	WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

; Off unless chosen: a reader that starts at every sign-in is the friend's
; decision. It starts minimised and opens no browser.
Section /o "Start tsundoku when I sign in" SecStartup
	CreateShortcut "$SMSTARTUP\tsundoku.lnk" "$INSTDIR\tsundoku.cmd" "--no-browser" "$INSTDIR\tsundoku.ico" 0 SW_SHOWMINIMIZED
SectionEnd

Section "-size"
	; Settings > Apps shows this; it's the program's size, never the library's.
	SectionGetSize ${SecMain} $0
	WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
SectionEnd

Function StartNow
	; Through Explorer, so tsundoku runs as the friend, not as a child of the
	; installer (and its window outlives it).
	Exec '"$WINDIR\explorer.exe" "$SMPROGRAMS\tsundoku.lnk"'
FunctionEnd

Section "Uninstall"
	!insertmacro StopRunning
	Delete "$SMPROGRAMS\tsundoku.lnk"
	Delete "$SMSTARTUP\tsundoku.lnk"
	!insertmacro RemoveProgram
	; FlareSolverr unzipped beside the program goes with it; in the data folder, it stays.
	RMDir /r "$INSTDIR\flaresolverr"
	Delete "$INSTDIR\uninstall.exe"
	; Only once empty: anything else a friend kept here stays.
	RMDir "$INSTDIR"
	DeleteRegKey HKCU "${UNINSTALL_KEY}"
	DeleteRegKey HKCU "Software\tsundoku"
	; Said once, and only when someone is there to read it.
	IfSilent +2
	MessageBox MB_OK|MB_ICONINFORMATION "tsundoku is uninstalled. Your library and settings are still in $LOCALAPPDATA\tsundoku; delete that folder to remove them too."
SectionEnd
