#!/bin/bash
# Aether Quill - 健康检查脚本
# 用途：检查所有服务的健康状态，支持 observability metrics
# 用法：./scripts/health-check.sh [service]
#       服务: web | api | rag-orchestrator | all (默认)

set -euo pipefail

SERVICE="${1:-all}"
RETRIES="${2:-3}"
INTERVAL="${3:-2}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

get_port() {
    case "$1" in
        web) echo 5173 ;;
        api) echo 3000 ;;
        rag-orchestrator) echo 3001 ;;
    esac
}

check_single() {
    local svc="$1" port
    port=$(get_port "$svc")

    for i in $(seq 1 "$RETRIES"); do
        local resp
        resp=$(curl -sf "http://localhost:$port/health" 2>/dev/null || true)
        if [ -n "$resp" ]; then
            local status
            status=$(echo "$resp" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")
            echo -e "${GREEN}[OK]${NC} $svc (port: $port) - status: $status"
            return 0
        fi
        if [ "$i" -lt "$RETRIES" ]; then
            sleep "$INTERVAL"
        fi
    done
    echo -e "${RED}[FAIL]${NC} $svc (port: $port) - 无响应"
    return 1
}

show_metrics() {
    local svc="$1" port
    port=$(get_port "$svc")
    local metrics
    metrics=$(curl -sf "http://localhost:$port/api/observability/metrics" 2>/dev/null || true)
    if [ -n "$metrics" ]; then
        echo "$metrics" | python3 -c "
import sys,json
d=json.load(sys.stdin)
counters=d.get('counters',{})
histograms=d.get('histograms',{})
uptime=d.get('uptimeSeconds',0)
req_total=sum(v for k,v in counters.items() if 'http_requests_total' in k)
err_total=sum(v for k,v in counters.items() if 'errors_total' in k)
print(f'  请求总数: {req_total}')
print(f'  错误总数: {err_total}')
print(f'  在线时长: {uptime}s')
for k,v in histograms.items():
    if 'duration' in k:
        avg=v['sum']/v['count'] if v['count']>0 else 0
        print(f'  {k}: avg={avg:.0f}ms min={v[\"min\"]:.0f}ms max={v[\"max\"]:.0f}ms count={v[\"count\"]}')
" 2>/dev/null || true
    fi
}

exit_code=0

if [ "$SERVICE" = "all" ]; then
    echo "========================================="
    echo "  Aether Quill - 服务健康检查"
    echo "========================================="
    echo ""

    for svc in api rag-orchestrator web; do
        if check_single "$svc"; then
            show_metrics "$svc"
        else
            exit_code=1
        fi
        echo ""
    done

    if [ "$exit_code" -eq 0 ]; then
        echo -e "${GREEN}所有服务正常运行${NC}"
    else
        echo -e "${RED}部分服务异常${NC}"
    fi
else
    check_single "$SERVICE" || exit_code=1
    show_metrics "$SERVICE"
fi

exit "$exit_code"
