@echo off
cd /d "%~dp0"
node train-bot.mjs
if errorlevel 1 (
  echo Training could not finish. Please keep this message for troubleshooting.
) else (
  echo Your bot model has been saved. Reload the game to use it.
)
pause
