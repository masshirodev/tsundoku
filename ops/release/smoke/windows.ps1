# tsundoku's release smoke test on Windows (doc/RELEASE.md, "Smoke test"),
# run over `ssh win-test` by ops/release/smoke.sh with the bundle, the
# library and probe.mjs already copied into the home folder. tsundoku.exe,
# the tray (doc/TRAY.md), is what a friend starts; over SSH there's no
# taskbar, so it runs without an icon, as it must be able to.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$t = "$HOME\tsundoku-smoke"
$b = "$t\tsundoku"
$data = "$env:LOCALAPPDATA\tsundoku"
$failed = 0
function Check($what, $ok, $detail = '') {
	if ($ok) { "ok   $what $detail" } else { "FAIL $what $detail"; $script:failed++ }
}
function Answers {
	try { (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:42143/manifest.webmanifest' -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}
function Mine { @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$b\*" }) }
function Servers { @(Mine | Where-Object { $_.CommandLine -like '*serve.ts*' }).Count }

Remove-Item -Recurse -Force $t, $data -ErrorAction SilentlyContinue
Expand-Archive -Path "$HOME\bundle.zip" -DestinationPath $t
New-Item -ItemType Directory -Force "$data\library" | Out-Null
Expand-Archive -Path "$HOME\library.zip" -DestinationPath "$data\library"

'--- start'
Start-Process -FilePath "$b\tsundoku.exe" -ArgumentList '--no-browser'
for ($i = 0; $i -lt 90 -and -not (Answers); $i++) { Start-Sleep 2 }
Check 'tsundoku.exe starts tsundoku' (Answers)
$tray = @(Mine | Where-Object { $_.Name -eq 'tsundoku.exe' })
Check 'one tray runs' ($tray.Count -eq 1)
# Its child, the launcher, is a console program given no window (CREATE_NO_WINDOW).
$launcher = @(Mine | Where-Object { $_.ParentProcessId -eq $tray[0].ProcessId -and $_.CommandLine -like '*launch.ts*--tray*' })
Check 'and runs the launcher in tray mode' ($launcher.Count -eq 1)

'--- probe'
& "$b\node\node.exe" "$HOME\probe.mjs" $b
Check 'the probe passes' ($LASTEXITCODE -eq 0)

'--- listening'
$wide = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 42143, 4590, 8191 })
$wide | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) $((Get-Process -Id $_.OwningProcess).Name)" }
Check 'nothing listens beyond loopback' (@($wide | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count -eq 0)

'--- a second start'
$second = Start-Process -FilePath "$b\tsundoku.exe" -PassThru -Wait
Check 'returns at once' ($second.ExitCode -eq 0)
Start-Sleep 3
Check "and starts nothing more ($(Servers) server, $(@(Mine | Where-Object { $_.Name -eq 'tsundoku.exe' }).Count) tray)" ((Servers) -eq 1 -and @(Mine | Where-Object { $_.Name -eq 'tsundoku.exe' }).Count -eq 1)
Check 'and tsundoku still answers' (Answers)

'--- quit'
$quit = Start-Process -FilePath "$b\tsundoku.exe" -ArgumentList '--quit' -PassThru -Wait
Check '--quit stops it, and waits until it has' ($quit.ExitCode -eq 0)
Start-Sleep 2
Check "nothing of the bundle left running ($((Mine).Count))" ((Mine).Count -eq 0)
Check 'no java or node left' (@(Get-Process java, node -ErrorAction SilentlyContinue).Count -eq 0)
Check 'and the tray took its address with it' (-not (Test-Path "$data\tray.json"))

'--- tsundoku.cmd, in a window as before'
$p = Start-Process -FilePath "$b\tsundoku.cmd" -ArgumentList '--no-browser' -PassThru -WindowStyle Hidden `
	-RedirectStandardOutput "$t\launch.log" -RedirectStandardError "$t\launch.err"
# The launcher prints its address just after the server first answers, so
# wait for the line itself: checking it the moment tsundoku answered raced
# that print (2026.11.01.1's first smoke run failed here, the bundle fine).
$opened = { (Test-Path "$t\launch.log") -and ((Get-Content "$t\launch.log") -match 'Open http') }
for ($i = 0; $i -lt 90 -and -not ((Answers) -and (& $opened)); $i++) { Start-Sleep 2 }
Check 'still starts it' (& $opened)
taskkill /pid $p.Id /T /F | Out-Null
Start-Sleep 3
Check 'and closing its window stops it' (@(Get-Process java, node -ErrorAction SilentlyContinue).Count -eq 0)

'--- tray.log'; Get-Content "$data\logs\tray.log" -Tail 20
'--- launcher.log'; Get-Content "$data\logs\launcher.log" -Tail 20
if ($failed) { "`n$failed failed"; exit 1 } else { "`nall passed" }
