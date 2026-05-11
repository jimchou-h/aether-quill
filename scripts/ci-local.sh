#!/bin/bash
# Aether Quill - CI 本地模拟脚本
# 用途：在本地模拟 CI 流水线执行，验证代码质量

set -e

echo "========================================"
echo "Aether Quill - 本地 CI 模拟"
echo "========================================"
echo ""

# 记录开始时间
start_time=$(date +%s)

# 定义颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 执行步骤函数
run_step() {
    local step_name="$1"
    local command="$2"
    
    echo -e "${YELLOW}[开始] $step_name${NC}"
    echo "----------------------------------------"
    
    if eval "$command"; then
        echo -e "${GREEN}[通过] $step_name${NC}"
        echo ""
        return 0
    else
        echo -e "${RED}[失败] $step_name${NC}"
        echo ""
        return 1
    fi
}

# 步骤1: Lint
if ! run_step "Lint" "pnpm lint"; then
    exit 1
fi

# 步骤2: Type Check
if ! run_step "Type Check" "pnpm typecheck"; then
    exit 1
fi

# 步骤3: Test
if ! run_step "Test" "pnpm test"; then
    exit 1
fi

# 步骤4: Build
if ! run_step "Build" "pnpm build"; then
    exit 1
fi

# 计算耗时
end_time=$(date +%s)
duration=$((end_time - start_time))

echo "========================================"
echo -e "${GREEN}✅ 所有 CI 步骤通过！${NC}"
echo "========================================"
echo "总耗时: $duration 秒"
echo "========================================"