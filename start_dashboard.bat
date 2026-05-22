@echo off
title Techora WhatsApp Broadcast Bot Server
echo =======================================================
echo   Starting Techora WhatsApp Broadcast Bot Web Server...
echo =======================================================
echo.

echo Starting Cloudflare Tunnel in background...
start "Techora Cloudflare Tunnel" /min .\cloudflared.exe tunnel --no-autoupdate run --token eyJhIjoiZmFjN2QzNWNjNzE1MmMwNjA5MWVlNDA3MmQ1ODA2NmUiLCJ0IjoiNGE2NGEwNzQtMjAzNy00MzVmLWJjNmMtODU3Yzk4ZmVhOTlmIiwicyI6Ik1qZzRaRGxsTVRZdE5EQmlOUzAwT0RFeUxXSXpPR1V0TkRsak56Vm1OV05qT0RrMiJ9

node server.js
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server exited with code %errorlevel%.
    echo.
)
pause

