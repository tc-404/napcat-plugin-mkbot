@echo off

setlocal

cd /d "%~dp0"

set "EXIT_CODE=0"



rem Sharp 需下载 @img/sharp-win32-x64 等大包，网络慢时可拉长超时（毫秒）

call npm config set fetch-timeout 600000 >nul 2>&1



echo [MKbot] 1/2 npm install ...

call npm install

if errorlevel 1 (

  set "EXIT_CODE=1"

  echo [MKbot] npm install failed, build skipped

  echo [MKbot] 若卡在 sharp / @img/sharp-win32-x64，多为 registry 超时，可重试或设置镜像：

  echo        npm config set registry https://registry.npmmirror.com

  goto end

)



echo [MKbot] 2/2 npm run build ...

call npm run build

if errorlevel 1 (

  set "EXIT_CODE=1"

  echo [MKbot] npm run build failed

  goto end

)



echo [MKbot] build done -^> napcat-plugin-mkbot\



:end

echo.

pause

endlocal & exit /b %EXIT_CODE%

