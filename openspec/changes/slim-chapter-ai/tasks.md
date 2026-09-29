## 1. 合同与共享依赖解耦

- [x] 1.1 从 OpenAPI 移除 pipeline / compliance-check / typo 路径与 schema 引用，并保证保留的 optimize / workbench / auto-loop 合同仍可解析（验收：openapi 校验或现有合同检查通过；无砍除路径 `$ref`）
- [x] 1.2 将自动循环依赖的流式 helper 与人物块构建迁到中性模块，去掉对 pipeline session store / 合规产品服务的运行时依赖；补或改单测证明 auto-loop 人物块与流式调用仍可编译运行（验收：`chapter-auto-loop` 相关测试绿；不再 import 待删产品服务）

## 2. 竖切删除砍除栈

- [ ] 2.1 删除创作精修 + 一键终稿 + 批量精修：前端入口/Dialog/专用 utils/设置偏好，以及 API `/pipeline/*`、pipeline service/session 产品实现与仓库 `chapter.pipeline.*` 默认 prompt；保留路径回归测试仍绿（验收：章节菜单测/事件接线测无精修事件；api 无 pipeline 路由注册；相关单测删除或改写后套件绿）
- [ ] 2.2 删除终稿合规 + 独立错字：前端合规入口/Dialog，API `/compliance-check/*` 与 `optimize/typo-*`，合规服务与 typo 仓库默认；taskPrompt 分组不再含「创作精修」「终稿合规」（验收：对应单测更新；web/api typecheck 通过；grep 无产品入口字符串暴露给用户）

## 3. 保留路径冒烟

- [ ] 3.1 跑文笔优化（含 auto-loop）与按场成稿相关自动化测试，并做一次最小手工确认：章节页仅剩两套入口且可打开 Dialog（验收：相关 test 绿；手工清单勾选）
