# tsundoku's release smoke test on Windows (doc/RELEASE.md, "Smoke test"),
# run over `ssh win-test` by ops/release/smoke.sh with the bundle, the
# library and probe.mjs already copied into the home folder.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$t = "$HOME\tsundoku-smoke"
$data = "$env:LOCALAPPDATA\tsundoku"
Remove-Item -Recurse -Force $t, $data -ErrorAction SilentlyContinue
Expand-Archive -Path "$HOME\bundle.zip" -DestinationPath $t
New-Item -ItemType Directory -Force "$data\library" | Out-Null
Expand-Archive -Path "$HOME\library.zip" -DestinationPath "$data\library"
$p = Start-Process -FilePath "$t\tsundoku\tsundoku.cmd" -ArgumentList '--no-browser' -PassThru -WindowStyle Hidden `
	-RedirectStandardOutput "$t\launch.log" -RedirectStandardError "$t\launch.err"
for ($i = 0; $i -lt 90; $i++) {
	if ((Get-Content "$t\launch.log" -ErrorAction SilentlyContinue) -match 'Open http') { break }
	Start-Sleep 2
}
'--- launcher'; Get-Content "$t\launch.log"
'--- probe'
& "$t\tsundoku\node\node.exe" "$HOME\probe.mjs" "$t\tsundoku"
$probe = $LASTEXITCODE
'--- listening'
$wide = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 42143, 4590, 8191 })
$wide | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) $((Get-Process -Id $_.OwningProcess).Name)" }
$open = @($wide | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count
'--- stop'
taskkill /pid $p.Id /T /F | Out-Null
Start-Sleep 3
$left = @(Get-Process java, node -ErrorAction SilentlyContinue).Count
"left running: $left; listening beyond loopback: $open"
if ($probe -ne 0 -or $left -ne 0 -or $open -ne 0) { exit 1 }
