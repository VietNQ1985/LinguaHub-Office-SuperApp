@echo off
chcp 65001 >nul
title LinguaHub Office SuperApp - Chay ngay

set "APP_EXE=%LOCALAPPDATA%\LinguaHub Office SuperApp\linguahub-office-superapp.exe"
set "REL_EXE=%USERPROFILE%\.lht\release\linguahub-office-superapp.exe"

if exist "%REL_EXE%" (
    start "" "%REL_EXE%"
    exit /b 0
)

if exist "%APP_EXE%" (
    start "" "%APP_EXE%"
    exit /b 0
)

call "%~dp0run-dev.cmd"
