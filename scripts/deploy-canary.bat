@echo off
REM Aether Quill - 金丝雀部署脚本 (Windows)
REM 用法: scripts\deploy-canary.bat [web|api|rag-orchestrator] [version]
REM 示例: scripts\deploy-canary.bat api v1.2.3

setlocal enabledelayedexpansion

if "%1"=="" (
    echo 用法: %0 [web^|api^|rag-orchestrator] [version]
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

call :build_service
if %errorlevel% neq 0 exit /b 1

call :health_check
if %errorlevel% neq 0 exit /b 1

echo [%DATE% %TIME%] ===== 部署成功: %SERVICE%:%VERSION% ===== >> "%DEPLOY_LOG%"
echo 部署日志: %DEPLOY_LOG%
exit /b 0

:build_service
    echo [%DATE% %TIME%] 构建 %SERVICE%:%VERSION% ... >> "%DEPLOY_LOG%"
    cd /d "%PROJECT_ROOT%"
    if "%SERVICE%"=="web" (
        call pnpm --filter @aether-quill/web build
    ) else if "%SERVICE%"=="api" (
        call pnpm --filter @aether-quill/api build
    ) else if "%SERVICE%"=="rag-orchestrator" (
        call pnpm --filter @aether-quill/rag-orchestrator build
    ) else (
        echo 未知服务: %SERVICE%
        exit /b 1
    )
    if %errorlevel% neq 0 (
        echo [%DATE% %TIME%] 构建失败 >> "%DEPLOY_LOG%"
        exit /b 1
    )
    echo [%DATE% %TIME%] 构建完成 >> "%DEPLOY_LOG%"
    exit /b 0

:health_check
    if "%SERVICE%"=="web" set PORT=5173
    if "%SERVICE%"=="api" set PORT=3000
    if "%SERVICE%"=="rag-orchestrator" set PORT=3001
    echo [%DATE% %TIME%] 健康检查 (port: %PORT%) ... >> "%DEPLOY_LOG%"
    for /l %%i in (1,1,10) do (
        curl -sf http://localhost:%PORT%/health >nul 2>&1
        if !errorlevel! equ 0 (
            echo [%DATE% %TIME%] 健康检查通过 >> "%DEPLOY_LOG%"
            exit /b 0
        )
        timeout /t 2 /nobreak >nul
    )
    echo [%DATE% %TIME%] 健康检查失败 >> "%DEPLOY_LOG%"
    exit /b 1
