@echo off
title Push to GitHub
color 0A
cd /d "%~dp0"

echo ============================================================
echo         PUSHING TO GITHUB: Gagan-9/task-tracker
echo ============================================================
echo.

git push -u origin main

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [NOTE] If this is a new repository, make sure you created
    echo "task-tracker" at: https://github.com/new
    echo.
    pause
) else (
    echo.
    echo [SUCCESS] Successfully pushed to https://github.com/Gagan-9/task-tracker!
    echo.
    pause
)
