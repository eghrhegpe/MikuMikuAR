# perception-state — 状态生命周期集成审计（round-42）

## 审核范围

- **测试文件**：`frontend/src/__tests__/perception/perception-state.int.test.ts`（409 行，39 用例）
- **被测源码**：
  - `frontend/src/scene/motion/perception.ts`（820 行）— 状态 setter / 生命周期（activatePerception:316-377、deactivatePerception:396-421、_ensureObserverRegistered:250-313、onPerceptionModelRemoved:814-820）/ balanceSway setter（:500-515）/ pin/unpin（:627-672）
  - `frontend/src/scene/scene-migrate.ts`（104 行）— migratePerceptionData:46-65、migratePerceptionFromProcMotion:71-104
  - 关联：`perception-shared.ts:15-72`（PerceptionState 类型 + DEFAULT_PERCEPTION_STATE）、`scene-serialize.ts:1043-1061`（迁移消费/恢复路径）
- **与既往审计关系**：round-8 审 perception 拆分（barrel + perception-*.ts 子模块）；round-15 审 perception 全量（✅，含 deactivate 对称清理 reclaim listener 的 P4 fix，见 perception.ts:403-405）；round-41 审 perception-morph（注销不清 morph P2，对应 `_disposeLipSyncRuntime` 调用点 :239/:742/:802）。**本测试是状态生命周期集成层**：补 round-15 之后的 setter/生命周期/pin/迁移回归网，morph 清理细节由 round-41 的 perception-morph.int.test.ts 覆盖，二者互补、无重叠。
- **运行验证**：`cd frontend && npm run test -- src/__tests__/perception/perception-state.int.test.ts` → **39/39 通过**（2.8s）。`npm run check`（全量 tsc）未执行（与测试无关、耗时较长，跳过并在本报告注明）。

## 总体结论

✅ **通过**（0 个 P1 / 0 个 P2 / 2 个 P3 / 6 个 P4）。测试断言有效、mock 隔离正确、边界覆盖良好、无跳过用例；生产源码状态流单一、资源释放对称（除 1 处不对称 P4）、迁移逻辑为纯函数。风险均为低影响项，不阻断。

## 亮点

- **hoisted mock + vi.resetModules 隔离模式**（测试 :4-33，perception-mocks.ts:1-18 文档化约束）：mockState/mockPipeline 必须 `vi.hoisted` 留在测试文件，否则 `vi.resetModules()` 后 perception-mocks.ts 被重新求值生成「新实例」，断言将脱节误报 0 调用——测试作者踩过坑并固化成了共享工厂约束，后续拆分测试文件可安全复用。
- **断言与常量双源一致**：`blinkFrequency 0.25`（测试 :100-103 ↔ shared.ts:62）、`balanceSwayEnabled/Period/Amplitude` 默认值（测试 :84-91/:297-302 ↔ shared.ts:54/70-71），断言锚定真实常量而非魔法值。
- **副本语义验证**（测试 :93-98 ↔ perception.ts:425）：`getPerceptionState()` 返回展开副本、修改不影响内部——防止未来有人改成返回引用时回归网失效。
- **生命周期边界覆盖扎实**：无目标 warn（:178-182）、模型未加载 warn（:184-189）、重复激活去重（:202-210 ↔ 源码 :340-343）、焦点切换先注销旧 observer 再注册新（:212-221）、deactivate 幂等不抛错（:235-237）、模型移除只清理目标模型（:240-260）。
- **pin 语义回归网**：pin 后焦点切换 observer 不注销（:331-351 ↔ 源码 hasPinned 分支 :345/:359-361）、ADR-164 pin 上限移除（>5 个，:353-358）、unpin 白名单移除（:360-365）。
- **断言修正有据可查**（:197-199 `[fix:2026-08]` 注释）：原断言误复制「未加载」分支的 `not.toHaveBeenCalled`，与用例名相反——修正注释记录了历史错误，防止后人误解。
- **迁移边界完整**：null/undefined→null、旧格式→{focused,pinned:[]}、新格式透传（含 tier/allEnabled）、boneToggles 缺失→always-on、全 false→用户显式关闭（:276-295/:377-408），与 scene-serialize.ts:1043-1061 恢复路径一一对应。
- **生产源码状态流清晰**：单一场景级参数源 `_perceptionState`，所有 setter 汇入 `_setFocusedState`（perception.ts:148-150 原地 Object.assign 而非替换引用，避免已存在 context 捕获旧对象导致参数不生效——该陷阱有注释说明）；循环依赖经 `getScene()` 门面规避（:12-15）。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | scene-migrate.ts | :52-64（消费 scene-serialize.ts:1047） | `migratePerceptionData` 新格式仅凭 `'focused' in perception` 判定后直接 `as` 透传，未校验 `pinned` 存在性/形状；若存档含 focused 但缺 pinned（或 pinned 非数组），恢复路径 `for (const p of perceptionData.pinned)` 将抛 TypeError 崩掉整个 load。测试只覆盖合法新旧格式与 null，未覆盖 malformed 新格式 | 透传前加结构校验（`Array.isArray(pinned)` 等），或消费端防御 `?? []`；补一个 malformed 新格式用例（如 `{ focused: {...} }`）验证不崩 |
| 🟡 P3 | perception.ts | :429-465 | `setPerceptionState`（批量/恢复路径）只对 gaze 5 项钳制（:432-446），balanceSwayPeriod/Amplitude、breath/blink 等数值字段绕过单项 setter 的钳制（:507/:513/:551-563）直接写入——手改存档可注入越界值，与「各单项 setter 一致，避免绕过 clamp」注释（:430）矛盾 | 将钳制表收敛为共享 map（字段→[min,max]），批量与单项 setter 复用同一份，消除双源不一致 |
| 🟢 P4 | perception.ts | :666-671 vs :400-406 | unpin 末位活跃注销 observer 时不清理 reclaim listener（round-15 P4 fix 只落在 deactivatePerception:404），清理不对称；实际影响仅残留一个惰性监听器（每次 release 事件一次 Map 查找），无功能后果 | 与 deactivate 对称：observer 置空时一并 `removeReleaseListener` + `_reclaimListenerAdded=false` |
| 🟢 P4 | perception.ts | :687-690（+ :464） | `setPerceptionStateFor` 内 `setPerceptionState` 已调 `triggerAutoSave()`（:464），其后又显式调一次（:689）→ 双重触发；生产侧防抖 500ms（scene-serialize）掩盖了冗余，mock 下可观测到 2 次调用 | 删除 :689 的重复调用，或改由 setPerceptionState 返回是否已触发 |
| 🟢 P4 | perception.ts | :682-690 | `getPerceptionStateFor/setPerceptionStateFor` 的 modelId 参数被忽略（`_modelId` 前缀），仅为兼容旧调用保留；对调用方是隐式陷阱 | 保留兼容但补 JSDoc 明确「场景级单例，modelId 无效」，或在 function-map 标注废弃 |
| 🟢 P4 | 测试文件 | :191-221 | 「切换模型」等用例 `modelManager.get.mockReturnValue` 恒返回同一对象（不区分 m1/m2），断言只验证 register/unregister 次数，对「observer 确实指向 m2」不敏感；pin 用例已示范 `mockImplementation` 按 id 区分（:341-343） | 统一改用按 id 分支的 mockImplementation，使焦点切换断言能区分目标模型 |
| 🟢 P4 | 测试文件 | :278/:285/:292 | 迁移用例用 `as any` 模拟旧存档形状（测试专用、可接受），但形状字段拼写错误不会在类型层暴露 | 定义 `type LegacyProcMotionArchive = Partial<...>` 具名类型替代裸 `as any`，保留文档价值 |
| 🟢 P4 | 测试文件 | :368-375 | `setPerceptionStateFor` 用例未断言 triggerAutoSave；「未激活时调用不抛错」（:235-237）与「unpin 焦点模型保留 isActive」（源码 :660 分支）、「unpin 末位活跃注销 observer」（:666-671）等分支未覆盖 | 补 2-3 个用例：焦点 unpin 不释放骨骼、末位 unpin 触发 observer 注销、批量 setter 触发 autosave |

## 测试质量评价

- **断言有效性**：39 个用例断言均锚定真实可观察行为（状态值、副本语义、register/unregister 次数、钳制边界、迁移形状），无纯形式断言；`toHaveBeenCalledOnce` 精确匹配去重语义。
- **mock 合理性**：19 个 vi.mock 全部经共享工厂（perception-mocks.ts）构造，mockState/mockPipeline 用 vi.hoisted 规避 resetModules 新实例脱节（文件头有完整约束说明）；setupPerceptionTest 内完成模块级重置 + ADR-238 scene-action-bridge 桩注册（:141-185），每个用例状态隔离可靠。
- **边界覆盖**：钳制上下界+中间值双端验证（:304-320）、迁移 null/新旧格式四象限、pin 冲突（焦点切换 observer 保留）、重复激活、模型移除。主要盲区：malformed 新格式迁移（见 P3）、焦点 unpin 分支、observer run 回调帧级逻辑（本文件不触发 triggerLastObserver，属 performance/multi-model 测试域，非本文件缺陷）。
- **无跳过用例**：grep `it.skip/describe.skip/xit/todo` 零命中。
- **类型安全**：生产代码 0 处新增 `as any`/`@ts-ignore`（scene-migrate 的 `as unknown as` 双转、perception.ts 的 `as Record<string, unknown>` 均为有注释的受限转型，非 any 逃生）；测试侧 `as any` 仅限旧存档形状模拟（P4 已列）。

---

审核日期：2026-08-15
审核员：子代理 round42-perception-state
