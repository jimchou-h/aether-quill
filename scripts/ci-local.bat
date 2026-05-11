@echo off
REM Aether Quill - CI 本地模拟脚本
REM 用途：在本地模拟 CI 流水线执行，验证代码质量

setlocal enabledelayedexpansion

echo ========================================
echo Aether Quill - 本地 CI 模拟
echo ========================================
echo.

REM 记录开始时间
set start_time=%time%

REM 执行步骤函数
:run_step
set "step_name=%~1"
set "command=%~2"

echo [开始] %step_name%
echo ----------------------------------------

%command%
if %errorlevel% neq 0 (
    echo [失败] %step_name%
    echo.
    exit /b 1
)

echo [通过] %step_name%
echo.
exit /b 0

REM 步骤1: Lint
call :run_step "Lint" "pnpm lint"
if %errorlevel% neq 0 exit /b 1

REM 步骤2: Type Check
call :run_step "Type Check" "pnpm typecheck"
if %errorlevel% neq 0 exit /b 1

REM 步骤3: Test
call :run_step "Test" "pnpm test"
if %errorlevel% neq 0 exit /b 1

REM 步骤4: Build
call :run_step "Build" "pnpm build"
if %errorlevel% neq 0 exit /b 1

echo ========================================
echo ✅ 所有 CI 步骤通过！
echo ========================================
echo 本地 CI 模拟完成

endlocal