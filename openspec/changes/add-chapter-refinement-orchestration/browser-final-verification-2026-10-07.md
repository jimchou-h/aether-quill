# 浏览器闭环最终独立复验

日期：2026-10-07。任务范围：AQ-384 / AQ-385 的最新 R1、R2 与 B4 修复。仅验收；未开发、发布、归档或变更任务完成状态。

## 结论

**本轮修复通过；尚不能签收“所有非模型验收已完成”。**

上一份报告列出的 B4 三项具体缺陷——旧 run 清理合同、两场脚本、真实 apply 响应捕获——已关闭。独立运行真实 Web + API/service/engine + PG + 本地假编排器，desktop 七例与 narrow 七例均通过。另补四个严格浏览器探针，证明两种视口下 `ready` 和真实 `ready_with_issues` 都能明确确认并应用，候选、响应、数据库、UI 及刷新后 UI 全文相等。

没有发现新的生产代码阻断缺陷。尚缺的工程证据是原收口计划已要求的检查点保存故障集成、四条旧写作链路的完整执行、Settings 五模板编辑/发布/回滚实操。真实模型成稿质量仍属 AQ-386，本报告不评价文学效果。

## 独立执行结果

| 验收项 | 本轮结果 | 日志 |
|---|---|---|
| 全仓 lint | exit 0 | `.scratch/refinement-final-browser-acceptance/gate-lint.log` |
| 全仓 typecheck | exit 0 | 同目录 `gate-typecheck.log` |
| 全仓 test | 1066 pass / 0 fail / 9 skip | 同目录 `gate-test.log` |
| 全仓 build | exit 0 | 同目录 `gate-build.log` |
| OpenSpec strict validate | valid | 同目录 `validate.log` |
| 真实临时 PG 仓库与 service/engine 重建 | 10/10，0 skip | 同目录 `pg.log` |
| 真实 gateway → 真实 orchestrator → 本地假 provider | 原 R1/R2 反例关闭 | 同目录 `probes.log` |
| 正式 B4 浏览器资产 | 14/14，0 skip，2.8m | 同目录 `browser.log`；14 份 `test-results/**/trace.zip` |
| 补充严格应用探针 | 4/4 | 同目录 `strict-probe.log`；[哈希观察](evidence/browser-strict-observations-2026-10-07.json) |

9 个默认 skip 为 PG 专用分支；本轮另行执行 PG 10 项，不把 skip 计为通过，也不将有重叠的专项测试与全仓数量合计为唯一用例数。

浏览器测试只建立随机专用项目与中性章节；套件项目以及四个补充探针项目的 DELETE 日志均为 200。本次自建 API/Web/假编排器已停止，未修改作者章节或测试账号密码。未调用真实模型。API 使用本次 scratch 目录作 cwd，避免读写作者会话文件所在的数据目录。

## 已关闭的具体反例

1. `discardRefinementRuns` 按真实数组响应读取运行，携带 `expectedRunRevision`，失败会抛错；清理发生在 reset 脚本和重置章节之前。实际取消/继续、重复启动等跨例执行通过。
2. 假编排器将标题 keep，正文分成两个 rewrite 范围。首范围接受后第二范围挂起可稳定触发取消；取消前、取消后、继续后首稿均保留，同 run 新 attempt。
3. 应用捕获真实旧入口 `/knowledge/chapters/:chapterNo/optimize/apply`，正确读取 `data.chapter.content`，请求、2xx、非空正文及候选/响应/数据库相等断言均为必执行。
4. R1：inspect/plan/review 最终消息不包含项目长指导或文风样本；rewrite/repair 包含它们，任务合同和冻结人物/知识材料正常保留。
5. R2：同句锚点之后放下物件判 `superseded`，不登记旧持有状态，也不传播到下一范围确定状态小节。

## B4 正式用例仍有两处证据表述需要修正

### 第六例未实际进入 ready_with_issues（测试覆盖告警）

正式第六例注入低严重度 `style` 提示，但共用等待器允许 `ready|ready_with_issues`；没有精确断言 `ready_with_issues`。当前引擎把这些提示登记为 warning，正常完成为 **ready**。因此该例的名称和回填报告不能证明降级应用分支。

独立首跑严格等待 `ready_with_issues` 时，实际一直得到 `ready`；反例代码保存在 [低严重度提示复现](evidence/browser-low-warning-repro-2026-10-07.ts)，失败日志为 `.scratch/refinement-final-browser-acceptance/strict-first.log`。这是脚本不满足所声称覆盖条件，未据此认定产品行为错误。

补充探针改用首个范围的占位语候选触发程序门禁拒收，第二个范围正常改写；得到真实 `ready_with_issues` 并应用成功。中间空白候选夹具被有界重试恢复为 ready 的失败记录也保留在 `strict-empty-retry.log`，没有删掉失败只保留成功。

正式第六例还仅用 `toContainText` 检查 UI 中的标记，虽然候选/响应/数据库已全等，**UI 全文相等尚未写入正式回归资产**。补充探针已对刷新前后 `textContent()` 做全文相等断言，两视口、两终态均通过。建议将本轮严格断言和真实降级夹具纳入正式套件，避免回填再次夸大覆盖。

### “真实 apply 走 1307”的外部合同表述不准确

第五例实际验证 HTTP 400、版本冲突消息和不覆盖新正文，没有断言响应业务 code=1307。`HttpExceptionFilter` 当前对 BadRequestException 映射为 **1503**，丢弃内部异常携带的 code。这是既有全局行为，并非本轮改动；版本保护实际通过。

`api-contract.md`、OpenAPI 与 UI 仍使用“返回 1307”的表述，需要明确内部业务语义与外部 HTTP envelope 的差异。沿用旧路径的响应是兼容性选择，但不能把消息文本断言称为外部 code=1307 的验证；此处不要求本轮擅自修改旧全局过滤器。

## 完整非模型签收仍待补的既定证据

| 遗留验收项 | 本轮已有证据的限度 | 最小补齐方式 |
|---|---|---|
| checkpoint 保存失败集成 | 正式第四例注入的是 resume HTTP 500；不能证明运行中仓库保存失败后暂停、候选隔离和不可应用 | 隔离测试服务替换 repository 保存行为，在真实 service/engine 链路注入失败，观察持久化/运行状态与 UI 禁用；无需生产故障开关 |
| 旧方案改写、直接改写、自动循环、按场成稿 | 正式第七例证明入口存在和编辑态保护，未实际生成并应用；单测门禁不能替代该完整路径证据 | 在专用中性项目与脚本模型下逐条执行生成/应用并核对正文和版本保护 |
| Settings 五模板保存、发布、回滚 | 阶段隔离、冻结材料和模板相关单测已通过；没有本轮 Settings 实操证据 | 复用现有设置页，在专用项目验证草稿不影响已发布配置、发布/回滚影响新 run，旧 run 保持冻结版本 |

以上沿用 [原收口计划](acceptance-closure-plan-2026-10-07.md) 的 B4/B5 要求，没有新增产品功能或架构范围。补齐后可签收工程阶段；真实模型评测仍需单独通过。

## 复现与审计

- 正式浏览器执行：`.scratch/refinement-final-browser-acceptance/run-browser.cjs`，两视口，trace 开启；前提为已配置的本地 PG 与交接文档中专用测试账号。
- 严格补充执行：同启动器加 `--strict-only`；源码为 [严格应用探针](evidence/browser-strict-probe-2026-10-07.ts)。
- 启动器初次健康探测错选未鉴权 `/api/projects`，浏览器尚未执行即超时；已改用 `/health`，原记录为 `startup-first.log`。这是本次验收工具的失误，不计产品缺陷。
- 正式浏览器原栈日志保存在 `browser-stack.log` / `browser-api.log`，独立补充执行不会覆盖正式结果。
- 验收基于当前工作区，不只基于 HEAD；HEAD 为 `c848ce040ebc3b075ae9f5b9d6f04af8d784bb83`。关键源、测试与日志 SHA-256 见 [本轮指纹](evidence/browser-final-verification-manifest-2026-10-07.json)。
- 只新增验收报告/证据并更新入口链接，未改产品代码、正式测试用例、任务状态或归档状态。
