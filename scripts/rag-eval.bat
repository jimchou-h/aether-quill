@echo off
setlocal
cd /d "%~dp0.."
call pnpm --filter @aether-quill/rag-orchestrator test
