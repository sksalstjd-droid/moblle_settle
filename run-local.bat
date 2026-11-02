@echo off
setlocal
cd /d "%~dp0"
title Mobile Settlement Dev Server
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0run-local.ps1" -Port 5000
