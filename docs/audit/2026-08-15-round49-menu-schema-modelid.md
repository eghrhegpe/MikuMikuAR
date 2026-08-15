# round-49 — menu-schema modelId override 专项审核报告

> 审核员：子代理 round49-menu-schema-modelid（第 49 轮第 3 个测试）
> 审核日期：2026-08-15

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/menu-schema.modelid.test.ts`（36 行，2 用例，`@vitest-environment node`，头注释声称「ADR-166 §6.13 modelId override，拆自 menu-schema.test.ts」） |
| 被测源码 | `frontend/src/menus/menu-schema.ts`：`:24-68`（getStateValue 前缀分流，perception 分支 :36-39、motionModule 分支 :40-64）、`:70-117`（setStateValue，perception 分支 :92-96、motionModule 分支 :97-115）、`:120-122`（getBindFn）、`:127-130`（e2e-state-bridge 注册）；`frontend/src/scene/motion/perception.ts`：`:141-150`（_getFocusedState/_setFocusedState 单例读写）、`:424-426`（getPerceptionState）、`:429-465`（setPerceptionState 批量钳制）、`:681-690`（get/setPerceptionStateFor） |
| 测试 mock 工厂 | `frontend/src/__tests__/menu-schema-mocks.ts:92-107`（mockPerception：getPerceptionState/getPerceptionStateFor/setPerceptionState/setPerceptionStateFor 均为 vi.fn，For 变体返回 `{}`） |
| 运行验证 | `npm run test -- src/__tests__/menu-schema.modelid.test.ts` → **2/2 通过**（3ms，node 环境）；`npm run check`（tsc）后台执行，结果见文末 |
| 设计依据核实 | 测试头注释引用的 commit `933fa46d` 经 `git log` 核实存在（"fix(perception): 感知状态改场景级存储，消除 per-model 参数与编辑入口错配"）；`eyeTrackingEnabled` 为 PerceptionState 真实字段（perception-shared.ts:19），生产默认 `true`（:51） |

## 二、与既往轮次的关系（任务指定核实项）

| 轮次 | 审核对象 | 与本测试的关系 |
|------|----------|----------------|
| round-37（menu-schema.test.ts 渲染层） | statepath describe 覆盖 env/ui/light/perception 四前缀的 set 链路（`2026-08-15-round37-menu-schema.md`） | 主题相邻、断言维度互补：round-37 锁「前缀分流 + 显示值」，本测试锁「感知前缀无视 modelId 的场景级语义」。round-37 遗留 P3「getBindFn 丢弃 modelId/actionId」（menu-schema.ts:120-122，本审核确认仍在）与本文件主题直接相关——即便补齐 motionModule modelId 用例，UI bind 自更新路径仍不传 modelId，属 render 层遗留，超出本文件范围 |
| round-42（perception-state.int.test.ts） | setPerceptionState 批量钳制 P3 + 场景级单例存储（`2026-08-15-round42-perception-state.md`） | 本测试整体 mock 掉 perception 模块，不重复其钳制/生命周期断言；round-42 登记的 P4「setPerceptionStateFor 双 triggerAutoSave」（perception.ts:687-690）与「For 变体 modelId 被忽略」本审核确认仍在，与「menu-schema 侧感知前缀忽略 modelId」互为印证（生产层与菜单路由层语义一致） |
| round-46（menu-schema.motion-module.test.ts 前缀解析） | get/set 解析逻辑（menu-schema.ts:40-64/:97-115，`2026-08-15-round46-menu-schema-motion-module.md`） | **关键**：round-46 已明确登记 P3「modelId 显式覆写参数在 motionModule 分支零覆盖——menu-schema.modelid.test.ts 只测 perception，且注释明言『modelId 仅对 motionModule 生效』，即显式 modelId 恰恰是 motionModule 特有通路却无人测」，并给出补法（① gsv('motionModule.gaze.headYawRange','other-model') 断言 gms 收到 'other-model'；② set 侧无焦点守卫）。本审核确认：**该缺口至今未补**（见风险 P3） |

## 三、总体结论

⚠️ **有条件通过**（0 个 P1 / 0 个 P2 / 1 个 P3 / 4 个 P4）

被测生产代码健康：感知前缀读写为单行委托（menu-schema.ts:38/:94），modelId 有意忽略且与 perception 层场景级单例（perception.ts:141-150 直返 `_perceptionState`、:148-150 原地 Object.assign）语义一致，无 per-model 幽灵路径、0 处新增 `as any`/`@ts-ignore`、无资源/并发问题。但测试文件**名义主题与实测内容错位**：名为「modelId override 专项」，两个用例却只测 modelId 被忽略的 perception 前缀，真正消费 modelId 的 motionModule 覆写通路（round-46 已点名）仍零覆盖——此为通过条件。其余 4 项 P4 均为文档卫生与测试耦合细节，不阻塞。

## 四、亮点

- **判别力强的场景级回归守卫**（menu-schema.modelid.test.ts:21-28 ↔ menu-schema-mocks.ts:94）：mock 的 `getPerceptionStateFor` 返回 `{}`——若生产回退到 ADR-166 §3.5 曾规划的 per-model 路由（`getPerceptionStateFor(modelId)`），`val` 将取 `{}['eyeTrackingEnabled']` = undefined 且 `getPerceptionState` 零调用，两断言同时失败。双保险锁死「感知走场景级单例、无视 modelId」设计，抵御历史方向（ADR-166 §3.5 计划与现行实现相反）的回归。
- **写路径精确锁定**（:30-35）：`toHaveBeenCalledWith({ eyeTrackingEnabled: false })` 精确断言参数对象；值取非默认 `false`（生产默认 true，perception-shared.ts:51）与 mock 默认区分，写未生效必红。
- **共享工厂复用合规**：4 条 `vi.mock` 全部复用 `menu-schema-mocks.ts` 工厂（AGENTS.md §2.3「核心模块 mock 优先复用共享工厂」铁律），`mockPerception` 为超集形状，未内联差异化 mock。
- **历史注释可溯源**（:19-20）：commit `933fa46d` 经 git 核实存在且标题与注释描述一致，设计决策留痕可查。
- **生产感知分支极简**：menu-schema.ts:36-39/:92-96 各 1 行委托，`[fix:P3] 场景级存储` 注释与 perception.ts:69-71 的「参数收敛为单一 `_perceptionState`（所有 context 共享引用）」注释互相印证，无隐藏分支。

## 五、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | menu-schema.modelid.test.ts | :14-35（全文） | **「modelId override」名义主题零覆盖**：文件名 + 头注释声称 modelId override 专项，但两用例只测 perception 前缀——该前缀的 modelId 参数被生产代码有意忽略（menu-schema.ts:38/:94），而唯一消费 modelId 的 motionModule 分支（menu-schema.ts:50/:107 `mid = modelId ?? focusedModelId`）无任何用例。round-46 已点名此缺口并给出补法，本文件至今未补 | 按 round-46 处方补 2 用例：① `getStateValue('motionModule.gaze.headYawRange', 'other-model')` → `getModuleState` 收到 `'other-model'`（显式 modelId 优先于 focusedModelId）；② `focusedModelId` 为 null 时 `setStateValue('motionModule.x.y', v)` 不调用 `setModuleParam`（menu-schema.ts:108-110 守卫），与 round-46 测试 4 的 get 侧守卫对称 |
| 🟢 P4 | menu-schema.modelid.test.ts | :2 | 头注释「ADR-166 §6.13」不可解析：ADR-166 章节为一~八（无 §6.13），ADR-093 §6 为「验证」亦无子节——与 round-46 对 motion-module 测试头注释的同类 P4 同源；modelId override 的权威依据实为 commit 933fa46d + perception.ts:69-74 [fix:P3] 注释 | 注释改指 commit 933fa46d 或 ADR-204 拆分记录（round-46 P4 建议同款），消除不可解析引用 |
| 🟢 P4 | menu-schema.modelid.test.ts | :22 / :32 | ① `(getPerceptionState as ReturnType<typeof vi.fn>)` 断言转型（round-46 P4 同类，测试侧可收敛）；② **潜伏跨用例耦合**：`vi.clearAllMocks()` 只清调用历史、不清 `mockReturnValue` 实现，测试 1 注入的 `{eyeTrackingEnabled:true}` 将残留给后续新增用例——当前 2 用例无交叉读取故不发作 | ① 改 `vi.mocked(getPerceptionState)`；② `mockReturnValue` 移入 beforeEach 内按用例显式设置，或改用 `mockImplementation` |
| 🟢 P4 | menu-schema.ts | :8 | `modelRegistry` 死导入（round-46 P3 已登记，本审核确认仍存在）：motionModule 单源修复后全文不再引用，`strict:false` 下 `noUnusedLocals` 默认关闭故 `npm run check` 不报 | 删除该导入（`focusedModelId/uiState/setUIState` 仍需要），重跑 check 验证零新错误 |
| 🟢 P4 | perception.ts | :687-690 | `setPerceptionStateFor` 双重 `triggerAutoSave`（round-42 P4 已登记，本审核确认仍存在）：`setPerceptionState` 内部已触发（:464），:689 又显式调一次 | 删除 :689 重复调用 |

## 六、测试质量评价

- **断言有效性：中上。** 两用例对「感知前缀无视 modelId」这一设计点验证充分且有判别力：读用例值断言 + 调用断言双保险（`getPerceptionStateFor` mock 返回 `{}` 形成对照，per-model 回归必红）；写用例 `toHaveBeenCalledWith` 精确锁定参数对象与调用目标，能区分 `setPerceptionState` 与 `setPerceptionStateFor`。**但**对「modelId override」这一文件名义主题，断言为零（见 P3）——用例本身有效，主题错位。
- **mock 合理性：正确。** 共享工厂 + node 环境（纯状态路由无 DOM）；`mockReturnValue` 注入的 `eyeTrackingEnabled` 为真实字段（perception-shared.ts:19）且与生产默认 true 一致；`@vitest-environment node` 选择恰当（menu-schema 全模块无 DOM 依赖，与 round-46 同）。
- **边界覆盖：不足。** 感知前缀下「无 modelId / 未知 modelId」本就与 'other-model' 同路径（modelId 被忽略，补充价值低）；真正缺失的是 motionModule 显式 modelId 与 set 侧无焦点守卫两个低成本用例（P3，round-46 处方）。
- **无跳过**：无 `it.skip/.only/.todo`，无 fake timers，无 `@ts-ignore/as any`（测试侧仅类型化 cast，P4 已列）。
- **36 行充分性：对错参半。** 作为「感知前缀场景级回归」充分（2 用例两向闭环，密度高）；作为「modelId override 专项」不充分——核心通路（motionModule 覆写）缺失，建议补 2 用例至 ~50 行。

## 七、结论

- 总体结论：⚠️ **有条件通过**
- P1：0 ｜ P2：0 ｜ P3：1（modelId 覆写通路零覆盖，round-46 遗留未补）｜ P4：4
- 一句话摘要：生产代码感知/motionModule 双前缀路由健康、测试两用例判别力强，但「modelId override」专项名实不符——唯一消费 modelId 的 motionModule 通路仍未覆盖，补 2 个低成本用例即可转「通过」。

---

审核日期：2026-08-15
审核员：子代理 round49-menu-schema-modelid

（`npm run check`（tsc + i18n parity）已执行完毕：**exit 0 全绿**；本文件范围内源码经人工核对 0 处 `as any`/`@ts-ignore`。）
