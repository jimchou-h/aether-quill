#!/bin/bash
# Aether Quill - 部署演练 Smoke Test
# 用途：部署后验证服务可用性、核心功能链路、observability 接入
# 用法：./scripts/deploy-smoke.sh
# 返回码：0 全部通过 | 1 部分失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SMOKE_LOG="$PROJECT_ROOT/data/smoke-$(date +%Y%m%d-%H%M%S).log"
PASS_COUNT=0
FAIL_COUNT=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

mkdir -p "$PROJECT_ROOT/data"
exec > >(tee -a "$SMOKE_LOG") 2>&1

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
pass() { echo -e "${GREEN}[PASS]${NC} $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo -e "${RED}[FAIL]${NC} $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

check_http() {
    local url="$1" label="$2" expected_status="${3:-200}"
    local resp
    resp=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$resp" = "$expected_status" ]; then
        pass "$label ($resp)"
        return 0
    else
        fail "$label — 期望 $expected_status，实际 $resp"
        return 1
    fi
}

check_json_field() {
    local url="$1" field="$2" label="$3"
    local value
    value=$(curl -sf "$url" 2>/dev/null | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get('$field','<missing>'))
except: print('<parse_error>')
" 2>/dev/null || echo "<fetch_error>")

    if [ "$value" != "<missing>" ] && [ "$value" != "<parse_error>" ] && [ "$value" != "<fetch_error>" ]; then
        pass "$label ($field=$value)"
        return 0
    else
        fail "$label — 字段 $field 缺失或不可达"
        return 1
    fi
}

echo "========================================="
echo "  Aether Quill - 部署 Smoke Test"
echo "  $(date)"
echo "========================================="
echo ""

log "=== 1. 服务基础可用性 ==="
check_http "http://localhost:3000/health" "API 健康检查"
check_http "http://localhost:3001/health" "RAG Orchestrator 健康检查"

log ""
log "=== 2. API 端点可达 ==="
check_http "http://localhost:3000/api/projects" "Project 列表" 401

log ""
log "=== 3. Observability 端点 ==="
check_json_field "http://localhost:3001/api/observability/metrics" "uptimeSeconds" "RAG Orchestrator metrics"
check_json_field "http://localhost:3001/api/observability/logs" "logs" "RAG Orchestrator 日志"

log ""
log "=== 4. API Observability ==="
check_json_field "http://localhost:3000/api/observability/metrics" "uptimeSeconds" "API metrics"
check_json_field "http://localhost:3000/api/observability/logs" "logs" "API 日志"

log ""
log "=== 5. 一致性检查端点 ==="
local check_result
check_result=$(curl -s -X POST "http://localhost:3001/api/consistency/check" \
    -H "Content-Type: application/json" \
    -d '{"text":"主角林默站在港口。","context":{"characters":[{"name":"林默","status":"alive"}]}}' \
    2>/dev/null || echo "")
if echo "$check_result" | python3 -c "import sys,json;d=json.load(sys.stdin);assert 'overall' in d" 2>/dev/null; then
    pass "一致性检查端点正常"
else
    fail "一致性检查端点异常: $check_result"
fi

log ""
log "=== 6. 构建产物验证 ==="
if [ -f "$PROJECT_ROOT/apps/web/dist/index.html" ]; then
    pass "Web 构建产物存在"
else
    fail "Web 构建产物缺失"
fi
if [ -f "$PROJECT_ROOT/services/api/dist/main.js" ]; then
    pass "API 构建产物存在"
else
    fail "API 构建产物缺失"
fi
if [ -f "$PROJECT_ROOT/services/rag-orchestrator/dist/main.js" ]; then
    pass "RAG Orchestrator 构建产物存在"
else
    fail "RAG Orchestrator 构建产物缺失"
fi

log ""
log "========================================="
echo ""
log "结果: $PASS_COUNT 通过, $FAIL_COUNT 失败"
if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}全部 Smoke Test 通过!${NC}"
else
    echo -e "${RED}${FAIL_COUNT} 项失败，请检查日志: $SMOKE_LOG${NC}"
fi

echo "日志: $SMOKE_LOG"
exit $FAIL_COUNT
