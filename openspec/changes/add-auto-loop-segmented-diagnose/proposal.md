## Why

自动循环一次吃整章，长章命中上限大约 12 段，后半章优化不完。「章节优化分段字数」已能把 2 万字按 5000 切开，但循环没接上。作者要的是：**每一窗单独跑完整套自动优化**，而不是只把复诊切开。

## What Changes

- 按项目 `chapterOptimizeSegmentCharSize` 把章节切成字数窗（空行对齐，不腰斩段落）。
- **每一窗**独立跑现有循环（弹窗 N 轮对每一窗生效）：复诊 → 局部改写 → 闸门。
- **顺序写回**：窗 1 结束后才跑窗 2；已完成窗锁死。
- 上一窗末尾约 1 段 / 400 字只读，供衔接，不得再出条目。
- 某一窗失败或用户停止：停在该窗，前面保留，从该窗续跑。
- SSE / 活动条展示「第 i/M 窗」。
- 设置页说明该配置同时作用于自动循环。

## Capabilities

### New Capabilities

- `auto-loop-segmented-diagnose`: 自动循环按分段字数切窗，每窗独立跑循环。

### Modified Capabilities

- （无。`chapter-auto-optimize-loop` 尚未归档进 `openspec/specs/`。）

## Non-goals

- 不改 `from-plan` / `direct` / Pipeline 的切分实现。
- 不按字数整块重写正文（窗内仍只改命中自然段）。
- 不新增环境变量或错误码。
- 不把 session 落库。
- 不均分段落数（按剩余正文攒满约 N 字再切）。

## Impact

**OpenAPI**：`stage` 增加可选 `windowIndex` / `windowTotal`；session / `end` 增加续跑窗字段。请求体不新增字段。无 **BREAKING**。无新错误码。

**代码**：切窗纯函数 + `runChapterAutoLoopWindows` 外包现有引擎；service 读 settings；前端进度与续跑文案。
