@echo off
chcp 65001 >nul
title LinguaHub Office SuperApp - Dev Mode (Hot Reload)

set "PROJECT_DIR=C:\Users\VietNguyenQuoc\.codex\visualizations\2026\11\06\01a1b145-74bf-7dd0-9baa-6e195a6d29c2\LinguaHub-Office-SuperApp"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "CARGO_TARGET_DIR=D:\.linguahub-target"

cd /d "%PROJECT_DIR%"
npm run app
pause
