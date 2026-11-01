# The updater, smoke-tested on Windows (doc/UPDATES.md; card c182). Run over
# `ssh win-test` by ops/release/smoke.sh with installer.exe, latest.json (a
# signed pretend 9999.01.01 whose installer is installer.exe, from
# smoke/fake-update.ts), serve-dir.mjs and set-password.mjs in the home folder.
# This machine plays the release host on loopback; tsundoku is pointed at it,
# offered 9999.01.01, told to UPDATE, and must come back by itself.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$prog = "$env:LOCALAPPDATA\Programs\tsundoku"
$data = "$env:LOCALAPPDATA\tsundoku"
$site = "$HOME\update-site"
$app = 'http://localhost:42143'
$failed = 0
function Check($what, $ok, $detail = '') {
	if ($ok) { "ok   $what $detail" } else { "FAIL $what $detail"; $script:failed++ }
}
function Answers {
	try { (Invoke-WebRequest -UseBasicParsing "$app/manifest.webmanifest" -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}
function Serving {
	try { Get-Content "$data\serving.json" -Raw | ConvertFrom-Json } catch { $null }
}

Remove-Item -Recurse -Force $data, $prog, $site -ErrorAction SilentlyContinue
Start-Process "$HOME\installer.exe" -ArgumentList '/S' -Wait

# The release host: the version's folder, and the announcement.
New-Item -ItemType Directory -Force "$site\9999.01.01" | Out-Null
Copy-Item "$HOME\installer.exe" "$site\9999.01.01\tsundoku-win-x64.exe"
Copy-Item "$HOME\latest.json" "$site\latest.json"
# Its own node.exe: the installer stops anything run from the program's folder.
Copy-Item "$prog\node\node.exe" "$HOME\node-host.exe"
$hostp = Start-Process "$HOME\node-host.exe" -ArgumentList "`"$HOME\serve-dir.mjs`" `"$site`" 8765" -PassThru -WindowStyle Hidden

New-Item -ItemType Directory -Force $data | Out-Null
Set-Content -Path "$data\.env" -Value 'TSUNDOKU_UPDATES=http://127.0.0.1:8765' -Encoding ASCII
# Something of the friend's, to find again after the update.
Set-Content -Path "$data\keep-me.txt" -Value 'still here' -Encoding ASCII
# No password: the API answers without signing in (doc/SIGN-IN.md).
& "$prog\node\node.exe" --disable-warning=ExperimentalWarning "$HOME\set-password.mjs" $prog $data none

# As the Start menu starts it: the tray (doc/TRAY.md).
Start-Process -FilePath "$prog\tsundoku.exe" -ArgumentList '--no-browser'
for ($i = 0; $i -lt 90 -and -not (Answers); $i++) { Start-Sleep 2 }
$before = (Serving).pid
Check 'tsundoku runs, installed' ((Answers) -and $before) "pid $before"

'--- check'
$json = 'application/json'
$view = Invoke-RestMethod -Method Post "$app/api/updates" -ContentType $json -Body '{"action":"check"}'
Check 'it finds the signed 9999.01.01' ($view.available.version -eq '9999.01.01') "$($view.current) -> $($view.available.version) $($view.error)"
Check 'and offers UPDATE, being installed' ($view.how -eq 'install')

'--- update'
$r = Invoke-WebRequest -UseBasicParsing -Method Post "$app/api/updates" -ContentType $json -Body '{"action":"install"}'
Check 'UPDATE starts' ($r.StatusCode -eq 202)
# Downloading, checking, installing: this server goes, the new one comes.
$back = $false
for ($i = 0; $i -lt 120; $i++) {
	Start-Sleep 2
	$s = Serving
	if ($s -and $s.pid -ne $before -and (Answers)) { $back = $true; break }
}
Check 'tsundoku stopped, updated and came back by itself' $back "pid $before -> $((Serving).pid)"
$trays = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq "$prog\tsundoku.exe" })
Check 'and its tray with it, one of them' ($trays.Count -eq 1) "$($trays.Count)"
Check 'the installer it ran was the signed one, kept by version' (Test-Path "$data\updates\9999.01.01\tsundoku-win-x64.exe")
Check 'no half-download left' (-not (Test-Path "$data\updates\9999.01.01\tsundoku-win-x64.exe.part"))
# Started by the installer, the new copy serves as a fresh start does: it
# once inherited the old server's ORIGIN and served without Wi-Fi (bind.ts, SERVER_ENV).
$wifi = try { (Invoke-WebRequest -UseBasicParsing "$app/api/wifi").StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
Check 'and serves as a fresh start does (WI-FI there)' ($wifi -eq 200) "$wifi"
Check 'the data folder came through' ((Test-Path "$data\login.json") -and ((Get-Content "$data\keep-me.txt") -eq 'still here'))
# The new copy hasn't looked yet: CHECK, as SETTINGS would.
$after = Invoke-RestMethod -Method Post "$app/api/updates" -ContentType $json -Body '{"action":"check"}'
Check 'and the new copy finds 9999.01.01 too (the same installer, so the same version)' ($after.available.version -eq '9999.01.01') "$($after.current) $($after.error)"

'--- stop'
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$prog\*" } |
	ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $hostp.Id -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Start-Process "$prog\uninstall.exe" -ArgumentList '/S' -Wait
for ($i = 0; $i -lt 60 -and (Test-Path "$prog\uninstall.exe"); $i++) { Start-Sleep 1 }
Remove-Item -Recurse -Force $site, "$HOME\node-host.exe" -ErrorAction SilentlyContinue

if ($failed) { "`n$failed failed"; exit 1 } else { "`nall passed" }
