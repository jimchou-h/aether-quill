# AQ-383：诊断事实与整场状态合同修复

状态：本地代码修复与确定性验收完成，最新专项 150 pass，API 648 pass / 9 skip / 0 fail，lint / typecheck / Nest 编译 / OpenSpec strict 通过；最新完整 build 再次在 Prisma DLL 替换时报 EPERM。尚未提交/推送，AQ-383 保持 DOING。继续既有 change 和任务 4.1；AQ-386 真实模型门禁未完成。

## 背景与范围

20 字确定性样例已复现：未验证 inspect 引文进入必要事实索引；跨窗合并把中途状态当成必须出现在整场首尾的事实。错误 block ID 且引文在本场唯一存在的恢复已具备，不放开跨场取证。

## 修复合同

1. inspect 的有值事实必须验证原文 block、引文与当前诊断目标范围；唯一引文允许记录式重锚，不能从只读邻文或下一场借证据。无效输出进入既有有界恢复，不能当已验证事实缓存。
2. plan 恢复再次核验诊断索引，兼容旧 checkpoint；未经证实的 inspect 事实不得被标记为已验证必要事实。
3. 合并场景第一片段的 entryFacts、最后片段的 exitFacts 作为整场边界；其他片段事实作为内部 processFacts，保留证据与发生过程，不要求重复进入首尾状态。
4. 遗漏的边界事实只从已验证、同场且身份无歧义的来源确定性恢复，并记录来源；已有错误值、unknown、错误引文不被静默覆盖。
   模型把完整匹配已验证过程证据的事实列在首尾时，按程序角色索引归还过程清单，并记录 `inspect_process`；若该证据同时确实属于相应边界，则仍保留边界角色。此规则不修正错误值或伪造证据。
5. processFacts 由程序从验证索引构建，传递给改写与检查，持久化在内部场景交底中；模型不能自行声明已验证过程事实。公共 API / SSE / 模型 JSON 合同不增加必填字段。
6. 跨场证据、重复引文、角色同名状态歧义仍拒绝；调用预算、一次额外 plan 名额、暂停与续跑保护保持。
7. plan 输入包含程序验证的事实角色索引，首尾与过程分开交底。改写、单位复查、补修、最终接缝复查都接收当前范围的过程事实；不要求在正文中逐字复述证据。
8. 旧缓存若证据不成立，受控暂停且 `resumable=false`，保留候选供查看并提示新建运行。合法旧缓存可以唯一重锚、重建过程事实后续跑；已经接受的单位不重写，恢复计数不清零。

## 验收与测试

- 公共 seam：parseWindowInspection / parsePlanOutputWithRecovery / OrchestratedRefinementEngine.run，沿用本会话已经执行的复现路径。
- 无原文证据的 inspect 事实不能进入 plan；只读邻文不能作本窗证据。
- 短场及跨窗场的中途状态保留为过程事实，整场首尾准确；改写和检查均收到过程证据。
- 合法边界遗漏恢复有账本；错误值、错误引文、不确定事实仍阻断。
- 旧诊断 checkpoint 重验；连续非法 inspect 有界暂停；全章覆盖、恢复计数不重置。
- 运行 API lint / typecheck / test / build；涉及的既有模板与编排回归通过。真实模型质量评测不在本修复中标为完成。

## 交付证据

### 根因与红绿证据

这不是只有长章才会出现的模型能力问题：20 字中性样例即可复现原实现的合同缺陷。修复前测试分别失败于：不存在的引文被当成必要事实；中途位置产生 `fact_dropped`；明确边界整项遗漏仍阻断；旧改写 checkpoint 跳过证据复验；最终检查/补修缺少过程交底。先写失败测试，再修复相应 seam 并确认通过。

新增 `chapter-refinement.fact-contract.test.ts`，并补充 engine 实际执行测试；既有 util 测试只更新新合同下的边界遗漏预期及一个局部 block 下标不符合全章坐标的夹具。覆盖：

- inspect 无证据重试一次后暂停，零 plan 调用且不缓存非法结果；只读邻文/长段部分窗口不能作目标证据。
- 合并场景首尾与过程分离；完整匹配的过程事实错误归类可确定性归位；模型伪造的 processFacts 不采信。
- 首尾整项遗漏、唯一来源重锚可恢复且有记录；错误值、unknown、下一场专属证据仍拒绝。
- 新运行 / 旧 checkpoint 实际执行；旧有效缓存恢复过程事实，不重复 inspect/plan；合并后跨场证据受控暂停，不抛未处理异常。
- 超过 1.7 万字 / 140 段的中性文本跨窗合并：只锁整场首尾，中途事实全部保留。

### 自检结果（2026-10-08）

| 门禁 | 结果 |
| --- | --- |
| util + engine + fact-contract 专项 | 143 pass，0 fail |
| API `pnpm --filter @aether-quill/api test` | 641 pass，9 skip，0 fail / cancelled（共 650 项） |
| API lint | PASS |
| API typecheck | PASS |
| API Nest 编译 | 标准 build 中 Nest 编译成功；另单独执行 `pnpm --filter @aether-quill/api exec nest build` 验证 |
| 标准 API build | 未通过：Nest 后的 Prisma generate 替换 `query_engine-windows.dll.node` 返回 EPERM；未停止运行中的用户服务 |
| orchestrator 冻结材料 / 阶段注入 / 模板回退回归 | 14 pass，0 fail |
| OpenSpec strict validate | PASS |

API 的 9 个 skip 来自未配置真实 PG 测试地址；实际本地 orchestrator + 假 provider 的阶段隔离集成测试已通过。受限环境首次 pnpm 读取 node_modules 返回 EPERM；切换至正常权限执行标准命令后得到上述结果，首次受限环境失败不计作通过。

日志：`.scratch/fact-contract-{api-test,lint,typecheck,build}-2026-10-08.log`。本地证据可查看，日志不作为业务数据提交。

### 影响与回滚

- 代码限于 API 精修 util / engine 与确定性测试；内部场景交底新增可选 processFacts，公共 API / SSE / OpenAPI 不增加字段，不需数据库迁移。
- 过程保留是语义合同；确定性证据校验不等于小说语义/文笔已获证明。真实 DS V4 Pro 调用与作者质量反馈仍归 AQ-386，未在本次标为通过。
- 已存在 plan 动态输出预算、截断扩容、有限重试保持。新增角色索引和过程交底纳入实际调用预算；最终分组估算同时计入过程事实大小。
- 合法旧断点继续使用；无效旧诊断需重新创建运行，不通过放宽跨场证据解决。重新验证时保留当前候选供查看。
- 回滚仅撤销本次 util / engine / 测试的局部改动；新增内部可选字段不会影响旧读取器。工作区包含其他 AI 的大量未提交改动，禁止整文件/整仓回退；本次未提交或推送。
- 本修复未发布项目 Prompt、未改私有章节、未发起真实模型调用。

## 后续：第 2 窗 inspect 不可用（2026-10-08）

用户复测报告「第 2 窗 inspect 阶段模型输出不可用」。只读查询确认新 run 原文 6591 字，已通过第一窗，第二窗仅 1633 字。失败返回未落盘、checkpoint 又丢弃解析详情，因此不能声称已取得本次精确违约字段。同章旧运行的已保存第二窗结果可确定复现：一条入场事实的引文只存在于前只读邻文，且被标到本窗首 block；新校验正确拒绝它。

发现运行提示与新合同未对齐：system 中的「允许读取范围」可被理解为包含邻文，user prompt 的邻文只有文字标题而未加 read-only-neighbor 标签，也没有明确 Fact 引文只能来自目标窗。自动第二次 inspect 又原样发送同一 prompt，无法针对违约修复；最终暂停丢弃具体错误。

本次补充合同（仍绑定 AQ-383 / 任务 4.1）：

- user prompt 明确 Fact 来源必须是当前 diagnosis-window 的目标正文和 block 索引；邻文使用 read-only-neighbor 标签，只作衔接参考。不在目标内可确认的事实保持 unknown，不虚构证据。
- inspect 第一次合同失败后的第二次调用携带具体错误，要求重新输出完整 JSON；仍最多重试一次，预算与取消保护不变，不发起第三次调用。
- 持续失败时 checkpoint 的已有 progress.message 保留具体校验原因。API / SSE 不新增字段，不保存完整失败正文。
- 测试 seam 沿用 buildInspectUserPrompt 与 OrchestratedRefinementEngine.run；中性夹具复现邻文借证据、重试反馈及最终错误详情。实际新 run 的精确失败字段仍须后续运行捕获，不能用旧 run 推测冒充已确认。

补充交付：错误详情透传与「第二窗借邻文证据 → 带具体错误重试 → 修正后继续，首窗不重跑」均先红后绿。专项 144 pass；完整 API 642 pass / 9 PG skip / 0 fail（651 项），lint、typecheck 与独立 Nest 编译通过；标准 build 的 Prisma DLL 限制仍见前文。日志位于 `.scratch/inspect-feedback-{api-test,lint,typecheck}-2026-10-08.log`。未自动继续用户 run、未调用真实模型；待用户继续运行验证新提示与真实恢复效果。

## 后续：覆盖完成但候选大部分退回原文（2026-10-08）

只读核对 run `ad8127e6-ec56-46c2-953d-58be67e3c756`：6591 字均已处理，前两场的候选因三条整块逐字锁缺失被拒，4779 字退回原文。三条锁分别对应诊断的编辑目标 b22、b23、b44；其长度为 109、131、156 字。三场计划都是 patch，非主动 keep；最终 69 个非空原文段落中 68 个仍逐字存在，候选只增加 20 字。不能把覆盖完成视为质量目标达成。

确定的工程缺口：plan 输入未解释 protectedSpanIds 是整块字面不可变而非信息保留；rewrite 输入未传入程序门禁实际使用的逐字锁、章级必要事实及冻结用户要求，仅传了模型归纳的意图。无法证明丢锁候选本身的具体表达质量，因为失败正文没有保存。

本次范围仍属 AQ-383 / 4.1：

- plan 的运行时输入明确 protectedSpanIds 的整块逐字保留含义、空数组默认及使用场景；事实证据不构成字面锁，不能把准备润色或去重的整段同时锁定。
- rewrite 的运行时输入包含冻结用户要求、章级语义事实和当前写作单位的具体逐字锁；门禁与成稿接收同一组锁，范围外锁不传入。
- 不自动删除锁，不改变程序拒绝/回退、调用次数或完成统计合同；不修改项目私有 Prompt 或默认模板，不强制修改比例。
- 以中性文本的 engine seam 先复现「锁未告知导致退稿」，再验证精确锁传递、用户要求不被意图摘要替代、语义事实可换措辞及既有丢锁保护。真实模型文笔效果仍待复测。

交付证据：新用例修复前因锁未传入返回 ready_with_issues 并回退原文；修复后候选通过，当前范围锁与完整用户要求、章级语义事实均进入真实 engine 请求。专项 145 pass；完整 API 643 pass / 9 PG skip / 0 fail（652 项）。lint 初次只报新测试三处格式问题，修正后通过；typecheck、完整 build（Nest + Prisma generate）和 OpenSpec strict 通过。日志 `.scratch/lock-delivery-{special,api-test,lint,typecheck,build}-2026-10-08.log`。不覆盖前次门禁的历史失败记录。本次改动仅限通用精修合同传递与中性回归；未改私有章节或项目配置，未调用真实模型。

## 后续：同名入场 unknown 误伤已确认散场（2026-10-08）

run `eb4e0042-7785-4dc7-9d77-3c4b01f39407` 在 plan 暂停，报告 scene-4 两个状态 fact_downgraded。只读记录确认该场 inspect 的同名入场事实均为 unknown，散场事实均有本场原文证据。失败 plan 正文未保存，无法断言模型是否还存在真正的散场降级。

中性最小复现已确定代码缺陷：输入合法 plan（入场 unknown、同名散场已确认），校验仍输出相同 fact_downgraded。反向组合（入场已确认、散场 unknown）也误报。verifyNecessaryFactsPreserved 合并 entryFacts 与 exitFacts 的 null key 集合，忽略已验证索引的 role。

修复与验收仍绑定 AQ-383 / 4.1：

- 必要场景事实的降级与遗漏按场景 + entry / exit 角色判断；另一个时点的同名 unknown 不触发降级。
- 已确认的同角色事实真正改为 unknown 或错误值仍拒绝，不自动把 unknown 覆盖成已知，也不把入场值拿来证明散场值。
- 违规路径明确 entryFacts / exitFacts，便于分辨真实模型降级与边界未知；全章 protectedFacts 的既有保护保留。
- 用中性 parser / engine seam 验证两种合法同名未知、真正同角色降级及已知状态不能靠错误角色放行。公共 API 与 JSON 字段不变，不新增重试层。

交付证据：修复前四项红灯分别是两种合法 unknown 组合被误报、真正降级缺少角色路径、合法方案在 engine 暂停；修复后专项 150 pass。额外负例确认首尾值颠倒仍报 fact_dropped。engine 最终测试覆盖 plan 暂停后复用已保存诊断、一次 plan 后完成成稿，不重跑 inspect，也不遗留旧 plan 阻断。用同 run 的保存诊断构造保留角色的合法 plan 回放：四场、零违规、零回填；不是重放未保存的原失败模型输出。

完整 API 648 pass / 9 PG skip / 0 fail（657 项）；lint 一处新增测试格式修正后通过，typecheck 与 OpenSpec strict 通过。标准 build 的 Nest 阶段完成，随后 Prisma generate 替换 query_engine-windows.dll.node 返回 EPERM；未停止用户服务。本轮日志 `.scratch/fact-role-{red,special,api-test,lint,typecheck,build}-2026-10-08.log`。临时只读查询脚本删除，无模型调用、运行状态或章节修改。AQ-383 保持 DOING，真实模型继续验证仍归 AQ-386。
