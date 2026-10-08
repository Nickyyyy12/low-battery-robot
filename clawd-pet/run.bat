@echo off
rem Build and start the Clawd desktop pet (Windows). Add --demo to preview with fake data.
cd /d "%~dp0"
if not exist out mkdir out
javac -encoding UTF-8 -d out -sourcepath src src\clawd\ClawdPet.java
if errorlevel 1 (
  echo Build failed. Please install JDK 17 or newer.
  pause
  exit /b 1
)
start "" javaw -cp out clawd.ClawdPet %*
