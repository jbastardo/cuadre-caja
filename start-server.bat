@echo off
cd /d %~dp0
echo Starting server...
npx tsx server/index.ts
