@echo off
title Push Fluffy Bird to GitHub
color 0B

echo ============================================================
echo   🐥 FLUFFY BIRD VOICE GAME - GITHUB PUSH WIZARD
echo ============================================================
echo.

set SRC=%~dp0
set DST=%TEMP%\fluffy-bird-voice-repo

if not exist "%DST%" (
    mkdir "%DST%"
)

echo [Step 1/3] Syncing latest game files...
robocopy "%SRC%" "%DST%" /E /XD .git /XF *.log push_to_git.bat > nul

cd /d "%DST%"

echo [Step 2/3] Preparing git commit...
git config user.name "jabirjalal12"
git config user.email "jabirjalal12@gmail.com"
git branch -M main
git add .
git commit -m "Update: Fluffy Bird voice-controlled flight game" 2>nul

echo [Step 3/3] Checking remote repository...
git remote get-url origin >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo Please enter your GitHub repository URL:
    echo (Example: https://github.com/jabirjalal12/fluffy-bird-voice.git)
    set /p REPO_URL="Repo URL: "
    if not "%REPO_URL%"=="" (
        git remote add origin "%REPO_URL%"
    )
)

echo.
echo Pushing code to GitHub (Branch: main)...
git push -u origin main

if %ERRORLEVEL% equ 0 (
    echo.
    echo ============================================================
    echo   SUCCESS! Fluffy Bird game pushed to GitHub successfully!
    echo ============================================================
) else (
    echo.
    echo ============================================================
    echo   Push failed. If this is a new repo, please ensure it has
    echo   been created on GitHub: https://github.com/new
    echo ============================================================
)

echo.
pause
