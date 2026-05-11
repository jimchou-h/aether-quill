#!/bin/bash
# Aether Quill - 服务部署脚本
# 用途：构建并部署指定服务，支持版本标记和健康检查
# 用法：./scripts/deploy.sh [service] [version]
#       服务: web | api | rag-orchestrator | all
#       示例: ./scripts/deploy.sh api v1.2.3

set -euo pipefail

SERVICE="${1:-}"
VERSION="${2:-$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_LOG="$PROJECT_ROOT/data/deploy-$(date +%Y%m%d-%H%M%S).log"
VERSION_FILE="$PROJECT_ROOT/data/current-version.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [ -z "$SERVICE" ]; then
    echo "用法: $0 [web|api|rag-orchestrator|all] [version]"
    echo "示例: $0 api v1.2.3"
    exit 1
fi

mkdir -p "$PROJECT_ROOT/data"
exec > >(tee -a "$DEPLOY_LOG") 2>&1

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

health_check() {
    local port="$1"
    local retries="${2:-10}"
    for i in $(seq 1 "$retries"); do
        if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
            return 0
        fi
        warn "健康检查等待中 (${i}/${retries}) - port $port"
        sleep 2
    done
    return 1
}

record_version() {
    local svc="$1" ver="$2" pid="$3"
    local tmp
    if [ -f "$VERSION_FILE" ]; then
        tmp=$(cat "$VERSION_FILE")
    else
        tmp="{}"
    fi
    echo "$tmp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
d['$svc']={'version':'$ver','deployedAt':'$(date -u +%Y-%m-%dT%H:%M:%SZ)','pid':$pid}
print(json.dumps(d,indent=2))
" > "$VERSION_FILE"
}

build_service() {
    local svc="$1"
    log "构建 $svc:$VERSION ..."
    cd "$PROJECT_ROOT"
    case "$svc" in
        web) pnpm --filter @aether-quill/web build ;;
        api) pnpm --filter @aether-quill/api build ;;
        rag-orchestrator) pnpm --filter @aether-quill/rag-orchestrator build ;;
    esac
    log "构建完成: $svc"
}

start_service() {
    local svc="$1" port
    port=$(get_port "$svc")
    log "启动 $svc:$VERSION (port: $port) ..."

    cd "$PROJECT_ROOT"
    case "$svc" in
        web)
            nohup pnpm --filter @aether-quill/web dev > "$PROJECT_ROOT/data/web-$VERSION.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/web.pid"
            record_version web "$VERSION" $!
            ;;
        api)
            PORT=$port nohup node services/api/dist/main.js > "$PROJECT_ROOT/data/api-$VERSION.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/api.pid"
            record_version api "$VERSION" $!
            ;;
        rag-orchestrator)
            PORT=$port API_BASE_URL="http://localhost:3000" \
                nohup node services/rag-orchestrator/dist/main.js > "$PROJECT_ROOT/data/rag-$VERSION.log" 2>&1 &
            echo $! > "$PROJECT_ROOT/data/rag.pid"
            record_version rag-orchestrator "$VERSION" $!
            ;;
    esac

    sleep 2
    if ! health_check "$port"; then
        error "$svc 健康检查失败"
    fi
    log "$svc 已启动并健康 (PID: $(cat "$PROJECT_ROOT/data/$svc.pid" 2>/dev/null || echo 'unknown'))"
}

deploy_single() {
    local svc="$1"
    log "===== 部署 $svc ====="
    build_service "$svc"
    start_service "$svc"
    log "===== $svc 部署完成 ====="
}

case "$SERVICE" in
    all)
        deploy_single api
        deploy_single rag-orchestrator
        deploy_single web
        ;;
    web|api|rag-orchestrator)
        deploy_single "$SERVICE"
        ;;
    *)
        error "未知服务: $SERVICE (可用: web, api, rag-orchestrator, all)"
        ;;
esac

log "版本 $VERSION 已部署"
log "部署日志: $DEPLOY_LOG"
