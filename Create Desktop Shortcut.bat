@echo off
title Create Desktop Shortcut
color 0A

echo Creating ClickUp Task Tracker shortcut on your Desktop...

powershell "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\ClickUp Sync & Report.lnk'); $s.TargetPath='%~dp0Sync & Report.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='SHELL32.dll,264'; $s.Save()"

echo.
echo [SUCCESS] Shortcut "ClickUp Sync & Report" created on your Desktop!
echo.
pause
