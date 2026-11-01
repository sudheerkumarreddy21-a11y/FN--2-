@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Created .env - set SESSION_SECRET and TWOFACTOR_API_KEY.
  echo Tip: set OTP_DEV_MODE=true to test without SMS ^(the OTP is printed in this window^).
  notepad .env
  pause
  goto :eof
)
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org then run again.
  pause
  goto :eof
)
if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install --no-audit --no-fund
)
call npx --yes netlify-cli dev --port 8888 --open
