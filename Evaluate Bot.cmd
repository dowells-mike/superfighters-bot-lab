@echo off
cd /d "%~dp0"
set SF_EVAL_ROUNDS=2
node evaluate-bots.mjs
if errorlevel 1 echo Evaluation could not finish. Please keep this message for troubleshooting.
pause
