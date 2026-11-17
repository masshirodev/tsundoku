# Reading on a phone over home Wi-Fi, smoke-tested on Windows (doc/WIFI.md).
# Run over `ssh win-test` by ops/release/smoke.sh, with bundle.zip
# and set-password.mjs in the home folder. tsundoku runs here; the workstation
# plays the phone, across the real network, while this waits: this writes the
# pairing link to wifi-code.txt, the workstation opens it and writes what it
# saw to wifi-phone.txt.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$t = "$HOME\tsundoku-wifi"
$data = "$env:LOCALAPPDATA\tsundoku"
$app = 'http://localhost:42143'
$json = 'application/json'
$failed = 0
function Check($what, $ok, $detail = '') {
	if ($ok) { "ok   $what $detail" } else { "FAIL $what $detail"; $script:failed++ }
}
Remove-Item -Recurse -Force $t, $data, "$HOME\wifi-code.txt", "$HOME\wifi-phone.txt" -ErrorAction SilentlyContinue
Expand-Archive -Path "$HOME\bundle.zip" -DestinationPath $t
New-Item -ItemType Directory -Force $data | Out-Null
& "$t\tsundoku\node\node.exe" --disable-warning=ExperimentalWarning "$HOME\set-password.mjs" "$t\tsundoku" $data none
# What a friend's "Allow access" makes: nobody is at Zen's desktop to click it.
New-NetFirewallRule -DisplayName 'tsundoku smoke' -Direction Inbound -Action Allow -Profile Any `
	-Program "$t\tsundoku\node\node.exe" | Out-Null

$p = Start-Process -FilePath "$t\tsundoku\tsundoku.cmd" -ArgumentList '--no-browser' -PassThru -WindowStyle Hidden `
	-RedirectStandardOutput "$t\launch.log" -RedirectStandardError "$t\launch.err"
for ($i = 0; $i -lt 90; $i++) {
	if ((Get-Content "$t\launch.log" -ErrorAction SilentlyContinue) -match '^Open ') { break }
	Start-Sleep 2
}
$v = Invoke-RestMethod -Method Post "$app/api/wifi" -ContentType $json -Body '{"action":"on"}'
Check 'WI-FI switches on, listening at a home address' ($v.on -and $v.phone -match '^http://(10|172|192)\.') $v.phone
Check 'with a pairing code' ($v.code.url -match '/pair/') $v.code.url
Set-Content -Path "$HOME\wifi-code.txt" -Value $v.code.url -Encoding ASCII

# The workstation, as the phone, opens it now.
for ($i = 0; $i -lt 90 -and -not (Test-Path "$HOME\wifi-phone.txt"); $i++) { Start-Sleep 2 }
$phone = Get-Content "$HOME\wifi-phone.txt" -ErrorAction SilentlyContinue
'--- the phone saw'; $phone
Check 'the phone was let in by the code, across the network' ($phone -contains 'pair 303 /welcome')
Check 'and is signed in there' ($phone -contains 'welcome 200 signed-in')
Check 'a stranger on the Wi-Fi with no code is sent to sign in' ($phone -contains 'stranger 303 /login')
$after = Invoke-RestMethod "$app/api/wifi"
Check 'the computer sees the code used' ($after.code.state -eq 'used')

'--- off'
Invoke-RestMethod -Method Post "$app/api/wifi" -ContentType $json -Body '{"action":"off"}' | Out-Null
$wide = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 42143 -and $_.LocalAddress -ne '127.0.0.1' }).Count
Check 'OFF stops listening on the Wi-Fi' ($wide -eq 0) "$wide left"

taskkill /pid $p.Id /T /F | Out-Null
Remove-NetFirewallRule -DisplayName 'tsundoku smoke'
Start-Sleep 2
if ($failed) { "`n$failed failed"; exit 1 } else { "`nall passed" }
