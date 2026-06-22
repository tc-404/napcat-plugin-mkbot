@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"

echo [MKbot] 1/2 npm install ...
call npm install
if errorlevel 1 (
  set "EXIT_CODE=1"
  echo [MKbot] npm install failed, build skipped
  goto end
)

echo [MKbot] 2/2 pnpm run build ...
call pnpm run build
if errorlevel 1 (
  set "EXIT_CODE=1"
  echo [MKbot] pnpm run build failed
  goto end
)

echo [MKbot] build done

:end
echo.
pause
endlocal & exit /b %EXIT_CODE%
