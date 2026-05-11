#!/bin/bash
# Aether Quill - 服务回滚脚本
# 用途：回滚到指定版本，支持自动阈值检测和手动回滚
# 用法：./scripts/rollback.sh [service] [--to-version <version> | --auto]
#       示例: ./scripts/rollback.sh api --to-version v1.2.3
#       示例: ./scripts/rollback.sh rag-orchestrator --auto
#       示例: ./scripts/rollback.sh --list

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/data/current-version.json"
ROLLBACK_LOG="$PROJECT_ROOT/data/rollback-$(date +%Y%m%d-%H%M%S).log"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

mkdir -p "$PROJECT_ROOT/data"
exec > >(tee -a "$ROLLBACK_LOG") 2>&1

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARN${NC} $*"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR${NC} $*"; exit 1; }

get_port() {
    case "$1" in
        web) echo 5173 ;;
        api) echo 3000 ;;
        rag-orchestrator) echo 3001 ;;
        *) echo 0 ;;
    esac
}

list_versions() {
    echo "========================================="
    echo "  已部署版本记录"
    echo "========================================="
    if [ -f "$VERSION_FILE" ]; then
        python3 -c "
import json
with open('$VERSION_FILE') as f:
    d = json.load(f)
for svc, info in d.items():
    print(f'  {svc}:')
    print(f'    版本: {info.get(\"version\",\"-\")}')
    print(f'    部署时间: {info.get(\"deployedAt\",\"-\")}')
    print(f'    PID: {info.get(\"pid\",\"-\")}')
" 2>/dev/null || echo "  无法解析版本文件"
    else
        echo "  暂无版本记录 ($VERSION_FILE 不存在)"
    fi
    echo ""

    echo "可用 git tags:"
    git tag --sort=-creatordate 2>/dev/null | head -10 || echo "  无 git tags"
    echo ""
}

check_health() {
    local svc="$1"
    local port
    port=$(get_port "$svc")
    for i in 1 2 3; do
        if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

check_error_rate_threshold() {
    local svc="$1"
    local port
    port=$(get_port "$svc")
    local threshold="${2:-5}"

    local metrics
    metrics=$(curl -sf "http://localhost:$port/api/observability/metrics" 2>/dev/null || echo "")

    if [ -z "$metrics" ]; then
        warn "无法获取 metrics（服务可能未运行）"
        return 0
    fi

    local error_rate
    error_rate=$(echo "$metrics" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    counters=d.get('counters',{})
    resp_5xx=sum(v for k,v in counters.items() if 'status=5' in k)
    resp_total=sum(v for k,v in counters.items() if 'http_responses_total' in k)
    if resp_total==0: print(0)
    else: print(round(resp_5xx/resp_total*100,1))
except: print(0)
" 2>/dev/null || echo "0")

    log "$svc 当前错误率: ${error_rate}%（阈值: ${threshold}%）"

    if [ "$(echo "$error_rate > $threshold" | bc 2>/dev/null || echo "0")" = "1" ]; then
        warn "错误率 ${error_rate}% 超过阈值 ${threshold}%，触发自动回滚条件"
        return 1
    fi
    return 0
}

stop_service() {
    local svc="$1"
    local pid_file="$PROJECT_ROOT/data/$svc.pid"
    if [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log "停止 $svc (PID: $pid)"
            kill "$pid" 2>/dev/null || true
            sleep 2
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$pid_file"
    fi
}

rollback_to_version() {
    local svc="$1"
    local target_version="$2"

    log "===== 回滚 $svc 到 $target_version ====="

    stop_service "$svc"

    if [ "$target_version" != "previous" ]; then
        log "检出目标版本: $target_version"
        git stash 2>/dev/null || true
        git checkout "$target_version" 2>/dev/null || warn "无法检出 $target_version（跳过）"
    fi

    log "安装依赖..."
    pnpm install 2>/dev/null || true

    log "构建 $svc ..."
    case "$svc" in
        web) pnpm --filter @aether-quill/web build ;;
        api) pnpm --filter @aether-quill/api build ;;
        rag-orchestrator) pnpm --filter @aether-quill/rag-orchestrator build ;;
    esac

    log "启动 $svc ..."
    local port
    port=$(get_port "$svc")
    cd "$PROJECT_ROOT"
    case "$svc" in
        web)
            nohup pnpm --filter @aether-quill/web dev > "$PROJECT_ROOT/data/web-rollback.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/web.pid"
            ;;
        api)
            PORT=$port nohup node services/api/dist/main.js > "$PROJECT_ROOT/data/api-rollback.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/api.pid"
            ;;
        rag-orchestrator)
            PORT=$port API_BASE_URL="http://localhost:3000" \
                nohup node services/rag-orchestrator/dist/main.js > "$PROJECT_ROOT/data/rag-rollback.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/rag.pid"
            ;;
    esac

    sleep 3
    if ! check_health "$svc"; then
        error "回滚后 $svc 健康检查失败"
    fi

    log "$svc 已回滚到 $target_version 并正常运行"
    log "===== 回滚完成 ====="
}

auto_rollback() {
    local svc="$1"
    log "===== 自动回滚检测: $svc ====="

    if ! check_error_rate_threshold "$svc" 5; then
        if [ -f "$VERSION_FILE" ]; then
            local prev_version
            prev_version=$(python3 -c "
import json
with open('$VERSION_FILE') as f:
    d = json.load(f)
print(d.get('$svc',{}).get('version','previous'))
" 2>/dev/null || echo "previous")
            log "错误率过高，自动回滚到: $prev_version"
            rollback_to_version "$svc" "$prev_version"
        else
            error "无版本记录，无法自动回滚"
        fi
    else
        log "$svc 错误率正常，无需回滚"
    fi
}

SERVICE="${1:-}"
ACTION="${2:-}"
TARGET="${3:-}"

case "${SERVICE}" in
    --list)
        list_versions
        exit 0
        ;;
    web|api|rag-orchestrator)
        case "$ACTION" in
            --to-version)
                if [ -z "$TARGET" ]; then error "请指定目标版本"; fi
                rollback_to_version "$SERVICE" "$TARGET"
                ;;
            --auto)
                auto_rollback "$SERVICE"
                ;;
            *)
                echo "用法: $0 [service] --to-version <version>"
                echo "       $0 [service] --auto"
                echo "       $0 --list"
                exit 1
                ;;
        esac
        ;;
    "")
        echo "用法: $0 [service] --to-version <version>"
        echo "       $0 [service] --auto"
        echo "       $0 --list"
        exit 1
        ;;
    *)
        error "未知服务: $SERVICE"
        ;;
esac

log "回滚日志: $ROLLBACK_LOG"
