@echo off
chcp 65001 >nul
cd /d "%~dp0"
node server.js
if errorlevel 1 (
  echo.
  echo 未找到 Node.js，请先安装 Node.js 18+。
  pause
)
