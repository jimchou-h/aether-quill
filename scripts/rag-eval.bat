@echo off
setlocal
cd /d "%~dp0.."
call pnpm --filter @aether-quill/rag-orchestrator run eval:gs-r -- --fail-on-threshold
if errorlevel 1 exit /b 1
call pnpm --filter @aether-quill/rag-orchestrator test
