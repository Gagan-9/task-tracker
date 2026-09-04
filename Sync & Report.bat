@echo off
title ClickUp Sync
color 0F
cd /d "%~dp0\server"

node sync-and-report.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    pause
) else (
    timeout /t 1 >nul
)
