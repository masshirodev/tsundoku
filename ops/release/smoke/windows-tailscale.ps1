# tsundoku on Tailscale, smoke-tested on Windows (doc/RELEASE.md, "Smoke
# test"). Run over `ssh win-test` by ops/release/smoke.sh, with
# bundle.zip and probe-tailnet.mjs in the home folder. With -Key (an
# ephemeral auth key), it installs tailscale.msi from the home folder and
# joins the tailnet first, and logs out after; without, Zen must already be
# signed in. Either way the tailnet needs MagicDNS and HTTPS certificates on.
# -Name is the node's name, a new one each run (smoke.sh says why).
param([string]$Key = '', [string]$Name = 'zen-tsundoku-smoke')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ts = "$env:ProgramFiles\Tailscale\tailscale.exe"
if ($Key) {
	Start-Process msiexec -ArgumentList '/i', "$HOME\tailscale.msi", '/quiet', '/norestart' -Wait
	# --unattended: nobody is signed in at Zen's desktop, and without it Tailscale
	# on Windows belongs to the desktop user, says Success, then sits in NoState
	# (doc/WINDOWS-VM.md, "On a tailnet").
	& $ts up "--authkey=$Key" --unattended --hostname=$Name --timeout=120s
}
# Up, with its HTTPS certificate's name, before tsundoku asks for it.
for ($i = 0; $i -lt 60; $i++) {
	$st = & $ts status --json 2>$null | Out-String
	if ($st -match '"BackendState":\s*"Running"' -and $st -match '"CertDomains":\s*\[') { break }
	Start-Sleep 2
}
"tailnet: $(if ($st -match '"BackendState":\s*"(\w+)"') { $Matches[1] })"
$t = "$HOME\tsundoku-tailnet"
$data = "$env:LOCALAPPDATA\tsundoku"
Remove-Item -Recurse -Force $t, $data -ErrorAction SilentlyContinue
Expand-Archive -Path "$HOME\bundle.zip" -DestinationPath $t
New-Item -ItemType Directory -Force $data | Out-Null
# What the README tells a friend to add.
Set-Content -Path "$data\.env" -Value 'TSUNDOKU_SERVE=https' -Encoding ASCII
# And the password it needs before it'll go on Tailscale (doc/SIGN-IN.md).
& "$t\tsundoku\node\node.exe" --disable-warning=ExperimentalWarning "$HOME\set-password.mjs" "$t\tsundoku" $data 'smoke-password'
$p = Start-Process -FilePath "$t\tsundoku\tsundoku.cmd" -ArgumentList '--no-browser' -PassThru -WindowStyle Hidden `
	-RedirectStandardOutput "$t\launch.log" -RedirectStandardError "$t\launch.err"
for ($i = 0; $i -lt 90; $i++) {
	if ((Get-Content "$t\launch.log" -ErrorAction SilentlyContinue) -match '^Open ') { break }
	Start-Sleep 2
}
'--- launcher'; Get-Content "$t\launch.log"; Get-Content "$t\launch.err" -ErrorAction SilentlyContinue
'--- a second start'
# It should only open the running one and exit; a stuck one is stopped.
$q = Start-Process -FilePath "$t\tsundoku\tsundoku.cmd" -ArgumentList '--no-browser' -PassThru -WindowStyle Hidden `
	-RedirectStandardOutput "$t\again.log" -RedirectStandardError "$t\again.err"
if (-not $q.WaitForExit(60000)) { taskkill /pid $q.Id /T /F | Out-Null }
$again = Get-Content "$t\again.log" -Raw
$again
'--- probe'
& "$t\tsundoku\node\node.exe" "$HOME\probe-tailnet.mjs" "$t\launch.log" "$t\again.log"
$probe = $LASTEXITCODE
'--- stop'
taskkill /pid $p.Id /T /F | Out-Null
& $ts serve --https=8443 off 2>&1 | Out-Null
if ($Key) { & $ts logout 2>&1 | Out-Null }
Start-Sleep 3
$left = @(Get-Process java, node -ErrorAction SilentlyContinue).Count
"left running: $left"
if ($probe -ne 0 -or $left -ne 0) { exit 1 }
