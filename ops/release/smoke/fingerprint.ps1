# A bundle's own ffmpeg must fingerprint (doc/RELEASE.md, "Smoke test"),
# run on Zen by ops/release/smoke.sh through windows.ps1. ffmpeg's chromaprint
# muxer is the app's first route to a fingerprint and the pinned BtbN build
# has it; PATH is never named, since a future pin that drops the muxer is the
# risk this guards.
param([Parameter(Mandatory = $true)][string]$Bundle)
$ff = Join-Path $Bundle 'ffmpeg\bin\ffmpeg.exe'
$print = Join-Path $env:TEMP 'tsundoku-fingerprint.raw'

if (-not (Test-Path $ff)) { 'FAIL fingerprint: the bundle carries no ffmpeg'; exit 1 }

& $ff -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=14' `
	-ac 1 -ar 44100 -vn -t 6 -f chromaprint -fp_format raw -y $print
$bytes = if (Test-Path $print) { (Get-Item $print).Length } else { 0 }
Remove-Item -Force $print -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0 -or $bytes -lt 4) {
	"FAIL fingerprint: the bundle's ffmpeg has no chromaprint muxer (wrote $bytes bytes)"
	exit 1
}
"ok   fingerprint · $($bytes / 4) points"
