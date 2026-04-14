@echo off
chcp 65001 >nul 2>&1
title Zalo Group Scanner GUI

REM === Tìm Node.js ===
where node >nul 2>&1
if %ERRORLEVEL% == 0 goto :check_python

if exist "%~dp0nodejs_portable\node-v20.12.2-win-x64\node.exe" (
    set "PATH=%~dp0nodejs_portable\node-v20.12.2-win-x64;%PATH%"
    goto :check_python
)

echo [ERROR] Node.js not found!
echo Please install Node.js from https://nodejs.org/
pause
exit /b 1

:check_python
REM === Tìm Python ===
where python >nul 2>&1
if %ERRORLEVEL% == 0 (
    set PYTHON_CMD=python
    goto :check_deps
)

where python3 >nul 2>&1
if %ERRORLEVEL% == 0 (
    set PYTHON_CMD=python3
    goto :check_deps
)

echo [ERROR] Python not found!
echo Please install Python from https://www.python.org/
pause
exit /b 1

:check_deps
REM === Kiểm tra node_modules ===
if not exist "%~dp0node_modules" (
    echo [INFO] Installing Node.js dependencies...
    npm install
    echo.
)

:run
echo.
echo ============================================
echo   ZALO GROUP SCANNER GUI - Starting...
echo ============================================
echo.

%PYTHON_CMD% "%~dp0app.py"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Application exited with errors.
    pause
)
