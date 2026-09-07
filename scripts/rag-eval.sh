#!/usr/bin/env bash
# AQ-122 + AQ-357：RAG 回归（GS-R 离线基线 → orchestrator 单测）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm --filter @aether-quill/rag-orchestrator run eval:gs-r -- --fail-on-threshold
pnpm --filter @aether-quill/rag-orchestrator test
