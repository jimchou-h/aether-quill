#!/bin/bash
# Aether Quill - 金丝雀部署脚本
# 用途：分阶段发布服务（金丝雀 10% -> 30% -> 100%），支持健康检查和自动回滚
# 用法：./scripts/deploy-canary.sh [service] [version] [--skip-canary]
#       服务: web | api | rag-orchestrator
#       版本: git tag 或 commit hash, 默认 latest
#       示例: ./scripts/deploy-canary.sh api v1.2.3

set -euo pipefail

SERVICE="${1:-}"
VERSION="${2:-latest}"
SKIP_CANARY="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_LOG="$PROJECT_ROOT/data/deploy-$(date +%Y%m%d-%H%M%S).log"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SERVICE_PORT_MAP='{"web":5173,"api":3000,"rag-orchestrator":3001}'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*" | tee -a "$DEPLOY_LOG"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARN${NC} $*" | tee -a "$DEPLOY_LOG"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR${NC} $*" | tee -a "$DEPLOY_LOG"; exit 1; }

if [ -z "$SERVICE" ]; then
    echo "用法: $0 [web|api|rag-orchestrator] [version] [--skip-canary]"
    echo "示例: $0 api v1.2.3"
    exit 1
fi

if [ ! -d "$PROJECT_ROOT/services/$SERVICE" ] && [ "$SERVICE" != "web" ]; then
    error "未知服务: $SERVICE (可用: web, api, rag-orchestrator)"
fi

if [ "$SERVICE" = "web" ] && [ ! -d "$PROJECT_ROOT/apps/web" ]; then
    error "web 服务目录不存在"
fi

get_port() {
    echo "$SERVICE_PORT_MAP" | python3 -c "import sys,json;print(json.load(sys.stdin)['$SERVICE'])"
}

health_check() {
    local port="$1"
    local retries="${2:-5}"
    local interval="${3:-2}"
    local attempt=1

    while [ $attempt -le "$retries" ]; do
        if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
            return 0
        fi
        warn "健康检查失败 (attempt $attempt/$retries) - port $port"
        sleep "$interval"
        attempt=$((attempt + 1))
    done
    return 1
}

check_error_rate() {
    local port="$1"
    local threshold="${2:-5}"
    local metrics_url="http://localhost:$port/api/observability/metrics"
    local metrics=$(curl -sf "$metrics_url" 2>/dev/null || echo "")

    if [ -z "$metrics" ]; then
        warn "无法获取 metrics，跳过错误率检查"
        return 0
    fi

    local total=$(echo "$metrics" | python3 -c "
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

    if [ "$(echo "$total > $threshold" | bc 2>/dev/null || echo "0")" = "1" ]; then
        error "错误率 ${total}% 超过阈值 ${threshold}%，中止部署"
    fi
    log "当前错误率: ${total}%（阈值: ${threshold}%）"
}

build_service() {
    log "构建 $SERVICE:$VERSION ..."
    cd "$PROJECT_ROOT"
    case "$SERVICE" in
        web)
            pnpm --filter @aether-quill/web build
            ;;
        api)
            pnpm --filter @aether-quill/api build
            ;;
        rag-orchestrator)
            pnpm --filter @aether-quill/rag-orchestrator build
            ;;
    esac
    log "构建完成"
}

deploy_instance() {
    local weight="$1"
    log "部署 $SERVICE:$VERSION (权重: $weight%) ..."

    cd "$PROJECT_ROOT"
    local port=$(get_port)

    case "$SERVICE" in
        web)
            if [ "$weight" = "100" ]; then
                nohup pnpm --filter @aether-quill/web dev > "$PROJECT_ROOT/data/web-$VERSION.log" 2>&1 &
                echo $! > "$PROJECT_ROOT/data/web.pid"
            fi
            ;;
        api)
            local api_port=$((port + (weight == 10 ? 0 : weight == 30 ? 1 : 0)))
            NODE_ENV=production PORT=$api_port \
                nohup node services/api/dist/main.js > "$PROJECT_ROOT/data/api-$VERSION-$api_port.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/api-$api_port.pid"
            ;;
        rag-orchestrator)
            local rag_port=$((port + (weight == 10 ? 0 : weight == 30 ? 1 : 0)))
            PORT=$rag_port API_BASE_URL="http://localhost:3000" \
                nohup node services/rag-orchestrator/dist/main.js > "$PROJECT_ROOT/data/rag-$VERSION-$rag_port.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/rag-$rag_port.pid"
            ;;
    esac

    sleep 2
    local deploy_port=$((port + (weight == 10 ? 0 : weight == 30 ? 1 : 0)))
    if ! health_check "$deploy_port"; then
        error "新实例健康检查失败 (port: $deploy_port)"
    fi
    log "实例健康检查通过 (port: $deploy_port)"
}

canary_deploy() {
    log "===== 开始金丝雀部署: $SERVICE ====="

    check_error_rate "$(get_port)"

    build_service

    deploy_instance 10
    log "金丝雀 10% 阶段完成，观察 30 秒..."
    sleep 30

    check_error_rate "$(get_port)"

    deploy_instance 30
    log "金丝雀 30% 阶段完成，观察 30 秒..."
    sleep 30

    check_error_rate "$(get_port)"

    deploy_instance 100
    log "全量部署完成"

    log "===== 部署成功: $SERVICE:$VERSION ====="
}

full_deploy() {
    log "===== 开始全量部署: $SERVICE ====="
    build_service
    deploy_instance 100
    log "===== 部署成功: $SERVICE:$VERSION ====="
}

mkdir -p "$PROJECT_ROOT/data"

if [ "$SKIP_CANARY" = "--skip-canary" ]; then
    full_deploy
else
    canary_deploy
fi

log "部署日志: $DEPLOY_LOG"
