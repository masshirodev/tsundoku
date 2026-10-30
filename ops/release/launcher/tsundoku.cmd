@echo off
rem Starts tsundoku: the engine, the app, and the browser (doc/RELEASE.md).
title tsundoku
"%~dp0node\node.exe" --disable-warning=ExperimentalWarning "%~dp0launcher\launch.ts" %*
