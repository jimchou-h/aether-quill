# Domain Docs

Engineering skills 探索 codebase 时，应如何消费这个 repo 的 domain documentation。

## Layout

**single-context**：根目录 `CONTEXT.md` + `docs/adr/`（尽管本仓库是 pnpm monorepo，领域语言仍共用一份 glossary）。

## Before exploring, read these

- repo 根目录的 **`CONTEXT.md`**
- **`docs/adr/`** — 读取与你即将处理区域相关的 ADRs
- 既有产品/架构说明仍可读 `AGENTS.md` 与 `.docs/`（历史看板）；**进行中的变更规格以 `openspec/changes/<name>/` 为唯一 SSOT**

如果 `CONTEXT.md` / ADR 尚空，**静默继续**。不要标记缺失；producer skill（如 `/grill-with-docs`）会在术语或决策真正落地时补写。

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
├── docs/agents/          ← issue tracker / triage / domain consumer rules
├── openspec/             ← OpenSpec specs + changes
├── apps/
├── services/
└── packages/
```

## Use the glossary's vocabulary

当你的输出命名某个 domain concept 时（issue title、refactor proposal、hypothesis、test name），使用 `CONTEXT.md` 中定义的 term。不要漂移到 glossary 明确避免的 synonyms。

## Flag ADR conflicts

如果你的输出与现有 ADR 矛盾，明确指出，而不是静默覆盖。
