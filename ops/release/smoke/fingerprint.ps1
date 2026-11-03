# A bundle's own tools must fingerprint (doc/RELEASE.md, "Smoke test"; c297),
# run on Zen by ops/release/smoke.sh through windows.ps1. The bundle's own
# ffmpeg makes a tone and its own fpcalc makes points of it; PATH is never
# named, since this workstation's Arch fpcalc is how a bundle without one
# shipped unnoticed.
param([Parameter(Mandatory = $true)][string]$Bundle)
$ff = Join-Path $Bundle 'ffmpeg\bin\ffmpeg.exe'
$fp = Join-Path $Bundle 'fpcalc\fpcalc.exe'
$tone = Join-Path $env:TEMP 'tsundoku-fingerprint-tone.wav'
$print = Join-Path $env:TEMP 'tsundoku-fingerprint.json'

if (-not (Test-Path $ff)) { 'FAIL fingerprint: the bundle carries no ffmpeg'; exit 1 }
if (-not (Test-Path $fp)) { 'FAIL fingerprint: the bundle carries no fpcalc'; exit 1 }

& $ff -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=6' -ac 1 -ar 11025 -y $tone
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tone)) {
	'FAIL fingerprint: the bundle’s ffmpeg made no tone'
	exit 1
}
$text = & $fp -raw -json $tone | Out-String
if ($LASTEXITCODE -ne 0 -or $text -notmatch '"fingerprint"\s*:\s*\[\s*\d') {
	'FAIL fingerprint: the bundle’s fpcalc returned no points'
	exit 1
}
Remove-Item -Force $tone, $print -ErrorAction SilentlyContinue
'ok   fingerprint'
