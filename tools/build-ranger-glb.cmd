@echo off
setlocal EnableExtensions

set "SCRIPT_PATH=%~dp0build-ranger-glb.py"
set "BLENDER_PATH="

if defined BLENDER_EXE if exist "%BLENDER_EXE%" set "BLENDER_PATH=%BLENDER_EXE%"

if not defined BLENDER_PATH (
    for /f "delims=" %%I in ('where blender.exe 2^>nul') do (
        if not defined BLENDER_PATH set "BLENDER_PATH=%%~fI"
    )
)

if not defined BLENDER_PATH if exist "%ProgramFiles%\Blender Foundation" (
    for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender *") do (
        if exist "%%~fD\blender.exe" set "BLENDER_PATH=%%~fD\blender.exe"
    )
)

if not defined BLENDER_PATH if exist "%LOCALAPPDATA%\Programs\Blender Foundation" (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Blender Foundation\Blender *") do (
        if exist "%%~fD\blender.exe" set "BLENDER_PATH=%%~fD\blender.exe"
    )
)

if not defined BLENDER_PATH (
    for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\blender.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do (
        if exist "%%~B" set "BLENDER_PATH=%%~B"
    )
)

if not defined BLENDER_PATH (
    for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\blender.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do (
        if exist "%%~B" set "BLENDER_PATH=%%~B"
    )
)

if not defined BLENDER_PATH (
    echo Blender was not found on PATH or under:
    echo   %ProgramFiles%\Blender Foundation
    echo   %LOCALAPPDATA%\Programs\Blender Foundation
    echo.
    echo Set BLENDER_EXE to blender.exe, or run this single command after installing Blender:
    echo   blender.exe --background --factory-startup --python-exit-code 1 --python "%SCRIPT_PATH%"
    exit /b 1
)

echo Running the Ranger conversion once with:
echo   "%BLENDER_PATH%" --background --factory-startup --python-exit-code 1 --python "%SCRIPT_PATH%"
echo.

"%BLENDER_PATH%" --background --factory-startup --python-exit-code 1 --python "%SCRIPT_PATH%"
set "BUILD_EXIT_CODE=%ERRORLEVEL%"

if not "%BUILD_EXIT_CODE%"=="0" (
    echo.
    echo Ranger GLB conversion failed with exit code %BUILD_EXIT_CODE%.
)

exit /b %BUILD_EXIT_CODE%
