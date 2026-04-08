@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "FRONTEND_DIR=%ROOT_DIR%open-data-grid"
set "BACKEND_URL=http://localhost:8000/"
set "FRONTEND_URL=http://localhost:3000/"
set "CHROME_EXE="

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

echo Starting FastAPI backend...
start "Alchemy Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && python -m uvicorn app.main:app --reload --port 8000"

echo Starting Next.js frontend...
start "Alchemy Frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && set NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 && npm run dev"

echo Waiting for local servers to respond...
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$targets=@('%BACKEND_URL%','%FRONTEND_URL%'); foreach ($url in $targets) { $deadline=(Get-Date).AddMinutes(2); while ((Get-Date) -lt $deadline) { try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5 | Out-Null; break } catch { Start-Sleep -Seconds 2 } } }"

echo Opening localhost in Chrome...
if defined CHROME_EXE (
  start "" "%CHROME_EXE%" "%FRONTEND_URL%"
) else (
  start "" "%FRONTEND_URL%"
)

endlocal
