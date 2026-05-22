@echo off
title Techora WhatsApp Broadcast Bot Server
echo =======================================================
echo   Starting Techora WhatsApp Broadcast Bot Web Server...
echo =======================================================
echo.
node server.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with code %errorlevel%.
    echo.
)
pause
