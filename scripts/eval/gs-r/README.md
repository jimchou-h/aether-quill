# GS-R 评测（AQ-357）

离线默认路径：对 `gs-r-v1.json` 调用 `buildStructuredKnowledgeEvidence`，输出 Recall@K / MRR@10 / 命中来源分布。

```bash
# 仓库根目录
pnpm eval:gs-r
pnpm eval:gs-r -- --fail-on-threshold
pnpm eval:rag

# 或
bash scripts/rag-eval.sh
# Windows: scripts\rag-eval.bat
```

可选 live（需本机 rag-orchestrator）：

```bash
GS_R_LIVE=1 RAG_ORCHESTRATOR_URL=http://localhost:3001 pnpm eval:gs-r
```

报告写入 `scripts/eval/gs-r/reports/`（默认不入库，见 `.gitignore`）。
