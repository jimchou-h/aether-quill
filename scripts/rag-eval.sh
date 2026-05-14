#!/usr/bin/env bash
# AQ-122：RAG 阶段 1 最小回归（纯函数 + 不依赖在线向量）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm --filter @aether-quill/rag-orchestrator test
