# tsundoku's installer, smoke-tested on Windows (doc/RELEASE.md, "Smoke test"),
# run over `ssh win-test` by ops/release/smoke.sh with installer.exe, the
# library and probe.mjs in the home folder. Silent mode (/S) takes the
# defaults: no start at sign-in.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$prog = "$env:LOCALAPPDATA\Programs\tsundoku"
$data = "$env:LOCALAPPDATA\tsundoku"
$menu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\tsundoku.lnk"
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\tsundoku'
$failed = 0
function Check($what, $ok, $detail = '') {
	if ($ok) { "ok   $what $detail" } else { "FAIL $what $detail"; $script:failed++ }
}
function Answers {
	try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:42143/manifest.webmanifest' -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}
# What the Start-menu entry runs: the tray (doc/TRAY.md).
function Start-Tsundoku {
	Start-Process -FilePath "$prog\tsundoku.exe" -ArgumentList '--no-browser'
	for ($i = 0; $i -lt 90 -and -not (Answers); $i++) { Start-Sleep 2 }
}
# Through WMI, as the installer does: Get-Process can't always read a path.
function Running { @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$prog\*" }).Count }
function Target($lnk) { (New-Object -ComObject WScript.Shell).CreateShortcut($lnk).TargetPath }

Remove-Item -Recurse -Force $data, $prog -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$data\library" | Out-Null
Expand-Archive -Path "$HOME\library.zip" -DestinationPath "$data\library"

'--- install'
Start-Process "$HOME\installer.exe" -ArgumentList '/S' -Wait
Check 'installed into %LOCALAPPDATA%\Programs' ((Test-Path "$prog\tsundoku.exe") -and (Test-Path "$prog\tsundoku.cmd"))
Check 'a Start-menu entry, for the tray' ((Test-Path $menu) -and (Target $menu) -eq "$prog\tsundoku.exe") (Target $menu)
Check 'and one to reset the password' (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Reset tsundoku password.lnk")
Check 'no start at sign-in unless chosen' (-not (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\tsundoku.lnk"))
$entry = Get-ItemProperty $key -ErrorAction SilentlyContinue
Check 'listed in Settings > Apps' ($entry -and $entry.DisplayName -eq 'tsundoku') "$($entry.DisplayVersion), $($entry.EstimatedSize) KB"

'--- run'
Start-Tsundoku
& "$prog\node\node.exe" "$HOME\probe.mjs" $prog
Check 'the probe passes on the installed copy' ($LASTEXITCODE -eq 0)

'--- update, while it runs'
Check 'running before the update' ((Running) -gt 0) "$(Running) processes"
Start-Process "$HOME\installer.exe" -ArgumentList '/S' -Wait
Check 'the update stopped it' ((Running) -eq 0)
Check 'and left the program whole' (Test-Path "$prog\app\scripts\serve.ts")
# Killed, the tray leaves its tray.json behind; the next start finds nobody
# answering there and takes its place.
Start-Tsundoku
# The password the probe set is kept: no SET UP again after an update.
$log = Get-Content "$data\logs\launcher.log"
$since = ($log | Select-String -SimpleMatch -- '--- starting the launcher' | Select-Object -Last 1).LineNumber
$run2 = $log | Select-Object -Skip ($since - 1)
Check 'it starts again on the same data, password kept' ((Answers) -and (Test-Path "$data\login.json") -and -not ($run2 -match 'First start'))
Start-Process -FilePath "$prog\tsundoku.exe" -ArgumentList '--quit' -Wait
Check '--quit stops the installed copy' ((Running) -eq 0)

'--- reset the password'
# What the Start-menu shortcut runs; it waits for Enter on Windows, so give it one.
$reset = ('' | & "$prog\tsundoku.cmd" --reset-password 2>&1 | Out-String)
Check 'the reset forgets it' ((-not (Test-Path "$data\login.json")) -and ($reset -match 'forgotten')) $reset.Trim()

'--- uninstall'
Start-Process "$prog\uninstall.exe" -ArgumentList '/S' -Wait
# The uninstaller runs from a copy in %TEMP% and returns at once.
for ($i = 0; $i -lt 60 -and (Test-Path "$prog\uninstall.exe"); $i++) { Start-Sleep 1 }
Check 'the program is gone' (-not (Test-Path $prog))
Check 'and its Start-menu entries' (-not (Test-Path $menu) -and -not (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Reset tsundoku password.lnk"))
Check 'and its Apps entry' (-not (Test-Path $key))
Check 'the library stays' ((Test-Path "$data\tsundoku.sqlite") -and (Test-Path "$data\library\Mihon"))
Check 'nothing left running' (@(Get-Process java, node -ErrorAction SilentlyContinue).Count -eq 0)

if ($failed) { "`n$failed failed"; exit 1 } else { "`nall passed" }
