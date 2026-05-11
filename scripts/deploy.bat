@echo off
REM Aether Quill - 服务部署脚本 (Windows)
REM 用法: scripts\deploy.bat [web|api|rag-orchestrator] [version]

setlocal enabledelayedexpansion

if "%1"=="" (
    echo 用法: %0 [web^|api^|rag-orchestrator^|all] [version]
    echo 示例: %0 api v1.2.3
    exit /b 1
)

set SERVICE=%1
set VERSION=%2
if "%VERSION%"=="" set VERSION=latest

set PROJECT_ROOT=%~dp0..
set DEPLOY_LOG=%PROJECT_ROOT%\data\deploy-%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%.log
if not exist "%PROJECT_ROOT%\data" mkdir "%PROJECT_ROOT%\data"

echo [%DATE% %TIME%] ===== 开始部署: %SERVICE%:%VERSION% ===== > "%DEPLOY_LOG%"

if "%SERVICE%"=="all" (
    for %%s in (api rag-orchestrator web) do (
        call :deploy_single %%s
    )
) else (
    call :deploy_single %SERVICE%
)

echo [%DATE% %TIME%] ===== 部署完成: %SERVICE%:%VERSION% ===== >> "%DEPLOY_LOG%"
echo 部署日志: %DEPLOY_LOG%
exit /b 0

:deploy_single
    set svc=%1
    echo [%DATE% %TIME%] 构建 %svc%:%VERSION% ... >> "%DEPLOY_LOG%"
    cd /d "%PROJECT_ROOT%"
    
    if "%svc%"=="web" (
        call pnpm --filter @aether-quill/web build || exit /b 1
    ) else if "%svc%"=="api" (
        call pnpm --filter @aether-quill/api build || exit /b 1
    ) else if "%svc%"=="rag-orchestrator" (
        call pnpm --filter @aether-quill/rag-orchestrator build || exit /b 1
    ) else (
        echo 未知服务: %svc%
        exit /b 1
    )
    
    echo [%DATE% %TIME%] %svc% 构建完成 >> "%DEPLOY_LOG%"
    exit /b 0
