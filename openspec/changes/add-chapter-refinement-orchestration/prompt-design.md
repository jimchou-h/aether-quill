# 分阶段 Prompt 与写作指导

本文件定义新模板职责与测试边界，所有示例为通用小说改写指导。项目文风由用户设置，仓库不写入私有词表或特定题材内容。示例尚未经真实模型评测，不直接发布为默认。

## 1. 写作指导的位置

| 指导 | 负责阶段 | 规则 |
|---|---|---|
| 叙述视角、人物语气、文风偏好 | 项目 systemPrompt／样本 | 在正文和补修调用中生效；诊断／检查不背全文写作圣经 |
| 张力驱动力、情绪递进、主动权变化 | 整章与场内 brief | 写本场具体目标及转折，按剧情选择主要张力；不规定每场至少两种 |
| 一步一拍、关键节点放慢、过渡留白 | rewrite／repair task | 作为生成手法，不做逐拍数反应的检查配额 |
| 感官真实、具体细节 | rewrite／repair task | 按场景选最有效的感官焦点，避免触觉与固定反应重复；不要求每段三种感官 |
| 空间、时序、必要事实、逐字锁 | runtime contract＋程序／review | 原文引用可验证；未知属性不补造，模型没有覆盖事实锁的权限 |
| 用词准确、无套话、无摘要式压缩 | rewrite；review 只识别明显改坏 | 不要求每一段都改、不为了变化替换准确原词 |
| 全文／范围输出格式 | 各 task | 正文任务纯文本；分析任务严格 JSON；不让账本流入正文输出 |

「直白」在通用模板中指动作、对话和感受具体，用词准确，减少空泛总结；不能通过增加词汇强度替代人物推进。人物主观感受可保留，不为了把心理全部改为动作而制造位移。

## 2. 新任务键与路由

| templateKey | 档位 | 项目长文风／样本 | 输入／输出 |
|---|---|---|---|
| `chapter.refinement.inspect` | utility | 不注入 | 当前诊断窗口、只读邻文、要求、策略 → 场景与事实／问题 JSON |
| `chapter.refinement.plan` | utility | 不注入；只带简明偏好 | 完整窗口结果、场景索引 → ChapterBrief／SceneBrief JSON |
| `chapter.refinement.rewrite` | writing | 注入冻结的版本 | 当前写作范围、场内 brief、首尾事实、邻文 → 范围正文纯文本 |
| `chapter.refinement.review` | utility | 不注入；只带明确检查目标 | 原文／候选稿／锁／邻文 → 有证据问题和末态 JSON |
| `chapter.refinement.repair` | writing | 注入冻结的版本 | 已接受稿的目标范围、具体缺口、邻文 → 替换正文纯文本 |

五个任务均纳入 Settings 任务 Prompt、治理包、API 与 orchestrator 默认镜像；默认 draft。更新 `generation-profile`、`writing-style-samples`、`knowledge-retrieval` 的测试矩阵：inspect/plan/review 不注入文风样本；rewrite/repair 使用写作档。全文原文不得变成 embedding query。

### 2.1 阶段隔离按「最终组装消息」验证（B5）

上表的档位只对**最终发给模型的 system/user 消息**成立，不对请求体字段成立：

- 断言对象是 `buildLlmMessages` 拼装后的完整 system 与 user，用标记文本捕获；只断言 `omitProjectSystemPrompt` 之类的请求字段不能证明 omit 没被 override 重新开启。
- utility 档（inspect / plan / review）**不注入**项目长写作指导与冻结文风样本；writing 档（rewrite / repair）注入**冻结版本**的两者。
- 「不注入文风」不等于「删材料」：任务级 system（冻结模板）、冻结人物设定、冻结知识、该阶段的目标／必要事实／边界材料在所有阶段都仍随消息下发。
- 冻结样本为空时，writing 档也不得凭空补一段样本；项目 system 覆盖（run 冻结）优先于 omit，写作档不会被 omit 关掉。
- 预算按该阶段**实际发送的全部材料**计算，不是按「名义阶段」计算。
- **档位判定必须落在真实调用链上（R1 修复）**：`packages/config` 的 `isRefinementUtilityStageTemplateKey`
  是唯一来源；orchestrator 组装 `generationContext` 时按模板键决定 `omitProjectSystemPrompt`，
  并且**请求里带 `projectSystemPromptOverride` 不得把 omit 重新打开**（旧实现无条件置 false，
  导致五个阶段全部注入项目文风）。引擎侧同时只在写作档下发冻结的项目文风。
- 回归必须经真实入口：真实网关 → 真实 orchestrator HTTP → 假 provider 捕获最终 messages；
  手工设置正确的 omit 标志只能证明 assembler 正确，不能证明生产链路。

不能从作者自由文本自动截几句或删除部分内容冒充「简明偏好」；需要用于 utility 的偏好由本次编辑目标／明确合同表达，作者的完整创作指导由 writing 执行。

新任务默认不注入近期摘要／语义章节记忆／跨章事件卡。相关角色和知识由本 run 的冻结参考构建，旧入口开关不因此改变。必要的上一章／下一章衔接仅属于 chapter 边界快照，不能与场内 after-context 混为同一块。

## 3. inspect 输出合同

每个诊断窗输出：

```ts
type WindowInspection = {
  windowId: string;
  sceneFragments: Array<{
    startBlockId: string; endBlockId: string;
    startsNewScene: boolean; confidence: 'high' | 'low';
    goal: string; entryFacts: Fact[]; exitFacts: Fact[];
    proposedBeatEnds: Array<{ blockId: string; anchorQuote: string }>;
  }>;
  issues: Array<{
    sourceBlockId: string; anchorQuote: string;
    kind: 'goal_gap' | 'continuity' | 'expression_regression';
    why: string; editIntent: string;
  }>;
};
type Fact =
  | { key: string; value: null } // unknown，不虚构来源
  | { key: string; value: string; sourceBlockId: string; anchorQuote: string };
```

kind 不是文学评分。必要事实无法确认时 value=null；原文引文必须能在允许读取范围中唯一命中，问题目标必须位于当前可诊断窗而非只读邻文。跨窗 fragments 通过连续原文索引归并，不能仅因场景标题相似合并。

约束文本建议：只指出本轮要求未落实、必要衔接缺陷、明显重复或表达退化；每项给出原文证据与一个可执行编辑意图。没有问题则空数组，不凑条目、不输出改写正文。

## 4. plan 输出合同

```ts
type RefinementBrief = {
  chapterIntent: string;
  protectedFacts: Fact[];
  sceneBriefs: Array<{
    sceneId: string; sourceBlockIds: string[];
    decision: 'keep' | 'patch' | 'rewrite'; reason: string;
    editIntent: string; expectedChange: string;
    entryFacts: Fact[]; exitFacts: Fact[];
    protectedSpanIds: string[];
    targetLength: { direction: 'hold' | 'expand' | 'condense'; minChars?: number; maxChars?: number };
    checks: Array<{ targetBlockId: string; expectedFact: string }>;
  }>;
};
```

全部 source blocks 必须归属 scene 并被决策覆盖。decision=keep 合法，不为全章修改率制造变化。允许方向性篇幅计划；没有证据时不凭空给每拍配精确字数。程序限制计划不得授权改变策略锁定事实。

上述类型是实施用输出合同草案，需在 gateway 使用运行时 schema 验证，而非只做 TypeScript 断言。JSON 解析失败、未知 ID、交叠、遗漏或引文失配最多重试一次，仍不合法则暂停或按 design.md 保守降级。unknown 不作为强制事实锁；必要事件／伏笔拍删除时，场内 editIntent 必须指出已验证的补偿落点，无法补偿则保留。

plan 的具体恢复规则见 [plan-contract-recovery.md](plan-contract-recovery.md)：只从唯一匹配的已验证事实索引回填缺失证据字段，再全量校验；仍失败时最多一次额外 plan 调用，与网络／解析重试共用名额。不能把有值 Fact 删掉或改 null 放行。只有独立验证事实和范围均有效的局部场景可降级 keep，其余暂停。

**给正文的交底**只保留：这场要产生的变化、要改的落点、必要事实与首尾状态、篇幅方向。完整问题账本留在 run，不重复注入正文。

## 5. rewrite 的通用写作指导样稿

> 你是小说编辑，按本次编辑交底改写当前范围，输出可直接拼回原文的正文。
>
> 围绕人物此刻的目标与阻力推进。让情绪和主动权变化落在具体选择、对话、停顿及回应中；避免用叙述者总结替代过程。
>
> 关键一拍写透最有辨识度的感受，过渡处保持速度。不同段落可转换感官焦点，优先准确细节，不凑感官数量，不重复同一种身体或情绪反应表示强度。
>
> 动作须有清楚的位置与因果。心理可以直接绑定正在发生的事；不要为替换心理解释而制造不合理位移。句长随节奏变化，保留准确原词，删掉套话和无效重复。
>
> 当前原文、首尾事实与逐字锁优先于文风建议；只读邻文不能改写、复述或并入输出。范围内怎样改按交底执行，不额外添加后文情节，不把中段写成章末。
>
> 只输出当前范围正文，不输出方案、过程清单、标题或占位语。

system 保留职责和硬边界；runtime user 输入提供具体目标、参考、原文和交底。不同时在多个块重复同一长规则。仅筛掉 system 内流程术语不等于隔离成功：必须检查最终拼装后的全部 system/user，正文输入不得含完整分析账本。

## 6. review 输出与 repair

review 接收冻结原文、候选正文、相关 brief、逐字锁和范围前后文；必须真正看到 after-context，不能拿只看候选稿的旧工作台检查充当边界保障。

输出 `issues[]` 与 `exitStateFacts[]`。issue 包含 kind、severity、candidate anchorQuote、expectedFact、source evidence、fixIntent。引文失配／位置不唯一的条目不进入自动修复，记录为未定位警告。

### 6.1 散场状态：引文命中 ≠ 末态成立（B2）

`exitStateFacts` 是**散场（范围末尾）仍成立**的状态，与「引文在候选中命中」是两件事。命中只证明片段存在；末态成立还要程序确认位置与顺序。事实除 `anchorQuote` 外必须给出末态证据记录：

```ts
type RefinementStateEvidence = {
  /** 证明该状态在范围末尾成立的候选片段；必须逐字出现在候选中且可唯一定位 */
  exitAnchorQuote: string;
  /** exit_confirmation：范围末尾明确确认；last_change：该状态在范围内的最后一次相关变化 */
  basis: 'exit_confirmation' | 'last_change';
  /** 锚点之后仍存在的、与同一状态相关的后续变化片段 */
  supersededBy?: string;
  /** 提取不确定：重复引文 / 末尾对白 / 跨段持续状态等 */
  uncertain?: boolean;
};
```

- **偏移一律由程序定位**，不采信模型给出的任何数字；锚点在候选中出现多次即位置不唯一。
- 程序负责检查：候选版本／hash、来源范围、锚点唯一位置、以及已报告变化的**顺序**。锚点之后若仍有与同一状态共享内容词的句段（如入场拿着钥匙、后面放下钥匙），判 `superseded`，不作为末态。
- **「锚点之后」从锚点结束处开始，不是从句段起点开始（R2）**：锚点位于句中时，它所在句的剩余部分同样属于「锚点之后」，必须纳入扫描。只保留「句段起点 ≥ 锚点结束」的句段会把同句后半句整体丢掉——`甲手里拿着钥匙走到门边后把钥匙放在桌上。` 中就因此把「把钥匙放在桌上」漏掉，错误地把「拿着钥匙」登记成末态并传给下一范围。
- 模型自报的 `supersededBy` 也必须由程序**校验其位置在锚点之后**；命中但位置在锚点之前或落在锚点内，判 `ambiguous`（先后关系无法确认），不直接采信为已取代。
- 判定结果分六类：`evidence`（可传播）／`superseded`（被后续变化取代）／`ambiguous`（重复引文、落在对白内、位置不可唯一定位、自标不确定）／`historical`（只有改写前原文能命中）／`unknown`（value=null）／`conflict`（凭空状态）。只有 `evidence` 进入确定状态集合并向下游传递，其余一律记为非阻断提示，不污染下游输入。
- 修复／补修／回退改变候选后，该单位旧候选上的证据立即失效；复检产生新证据后才重新向下游传递。checkpoint 与恢复保存同一候选版本的事实，缺版本信息的旧记录按不确定处理、不传播。
- **限制**：上述「相关性」是程序可判定的近似（共享内容词），不是语义判断。人物行为是否真的改变状态仍依赖 review 与 AQ-386 的模型评测；B2 只保证不确定结果不污染下游。
- 已锁定的必要事实、逐字锁与首尾状态仍按原合同校验；不得借「不确定」删除必要事实，也不得把有值锁改成 null 放行。

允许自动补修的条件：明确缺口或改坏，位置可验证，修复在本策略内且有剩余次数／预算。不因「还可以更浓」「可以更优美」或单一文学评分补修。

repair 只接收到当前目标的简短编辑意图和相关缺口，不重新规划本场。输出仅为目标替换正文；程序负责候选版本校验和拼接。

## 7. 发布与冻结

- 五个模板 v1.0.0，默认草稿；本轮未生成运行时种子或改镜像。
- 运行开始冻结发布文本／版本／hash；Settings 运行中发布新稿只影响下一个 run。
- 未配置自定义 task 时走仓库默认，不把已有旧模板复制为新模板的最终文本。
- 文风样本选择排除当前章节，按现有类型和预算适配；实际注入文本进入 run，恢复不重新选择。
- 有长章真实模型效果证据再发布，回滚版本不改变历史 run 的解释。
- 严禁把用户提供的长指导当成程序能保证的文学验收合同；同一手法的例外由场景目标决定，事实锁无例外。
