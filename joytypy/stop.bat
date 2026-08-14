@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist server.pid (
  for /f "tokens=*" %%i in (server.pid) do taskkill /PID %%i >nul 2>&1
  del server.pid
  echo 敲敲乐已停止。
) else (
  echo 未发现运行中的敲敲乐。
)
pause
