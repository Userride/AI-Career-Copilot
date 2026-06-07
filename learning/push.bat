@echo off
echo ==============================================
echo   Career Copilot Git Push Helper
echo ==============================================
echo.

echo [1/5] Initializing Git repository...
git init
echo.

echo [2/5] Staging files...
git add .
echo.

echo [3/5] Committing changes...
git commit -m "feat: implement LLM failover gateway and real-time LinkedIn & Gmail notifier"
echo.

echo [4/5] Setting up Git remote origin...
git remote add origin https://github.com/princekumar1-hash/learning.git 2>nul
if %errorlevel% neq 0 (
    git remote set-url origin https://github.com/princekumar1-hash/learning.git
)
echo.

echo [5/5] Pushing code to GitHub (main)...
git branch -M main
git push -u origin main
echo.

echo ==============================================
echo   Push completed!
echo ==============================================
pause
