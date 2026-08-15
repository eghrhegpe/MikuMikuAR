# Round 45 审核报告：resolveModelId（stable-identity 决策点）

## 审核范围

- **测试文件**：`frontend/src/__tests__/scene/resolve-model-id.test.ts`（38 行，5 用例，vitest node 环境）
- **被测源码**：`frontend/src/scene/manager/model-id.ts:1-11`（`resolveModelId`，纯函数）
- **间接引用（核对用）**：`frontend/src/scene/manager/model-loader.ts:551-553`（`loadPMXFile` 内 `resolveModelId(preferredId)` 调用点）、`frontend/src/core/uuid.ts:8-13`（`generateUuid` v4 实现）、ADR-193（`docs/adr/adr-193-stable-model-identity.md`）
- **验证**：`cd frontend && npm run test -- src/__tests__/scene/resolve-model-id.test.ts` → 5/5 通过（299ms）；`npm run check`（tsc + i18n 对齐）→ exit 0 全绿

## 总体结论

✅ **通过** —— 被测源码为 11 行纯函数，决策逻辑与 ADR-193 逐字一致（`preferredId` 非空即复用、否则 `generateUuid()`），零 Babylon 依赖、零共享状态、无 `as any`/`@ts-ignore`、无跳过测试；测试 5 用例对「复用 / 生成 / 空串回退 / 旧格式废弃」覆盖完整且断言有效，测试与类型检查双绿。仅发现 1 个 🟡 P3 防御性边界与 3 个 🟢 P4 观察，不阻塞。

## 亮点

- **决策点最小化 + 自文档化**：`model-id.ts:10` 单表达式三元，`preferredId && preferredId.length > 0 ? preferredId : generateUuid()`；`length > 0` 虽对 truthy 字符串冗余，但显式写出「空串也走生成路径」的契约，与测试第 4 用例一一对应，防后续误简化破坏语义。
- **模块边界干净**：`model-id.ts:1` 注释明示「独立模块，零 Babylon 依赖，便于单测」，实际仅依赖 `@/core/uuid` 零依赖叶（ADR-191 直连），无循环依赖、无重复代码、无魔法数值。
- **测试用值恒等断言直接锚定核心语义**：`resolve-model-id.test.ts:13` `expect(resolveModelId(saved)).toBe(saved)` —— 复用路径用 `toBe` 而非 `toMatch`，精确验证「返回的正是传入存档 uuid」这一跨会话稳定性核心不变量，非格式近似断言。
- **回归守卫覆盖旧行为**：`resolve-model-id.test.ts:34-37` 断言 `model_` 前缀不再出现，直接钉死 ADR-193 对旧 `model_${Date.now()}_${random}` 的废弃，防回退。
- **UUID 正则与生成器实现精确对齐**：`resolve-model-id.test.ts:8` 的 `UUID_RE` 校验版本位 `4` 与变体位 `[89ab]`，与 `core/uuid.ts:9-12`（`'xxxxxxxx-xxxx-4xxx-yxxx-...'`，y = `(r & 0x3) | 0x8`）逐位吻合，断言不是摆样子。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/scene/manager/model-id.ts` | 9-10 | 非空但**非 uuid / 纯空白**的 `preferredId`（如 `'   '`）会被原样透传为 id；空串有守卫、空白串没有。存档损坏或手改 `last_scene.json` 时可产生畸形 id 静默落盘 | 不在本函数强校验 uuid 格式（会破坏 `'gen-id'`/`'uuid-stable-1'` 等既有合法用法），建议在**序列化/恢复边界**（`scene-serialize.ts`）对 `m.uuid` 做 trim + 非空清洗，或在本函数补 `preferredId.trim()` 守卫并加对应测试 |
| 🟢 P4 | `frontend/src/__tests__/scene/resolve-model-id.test.ts` | 16-19 | 用例 2 对硬编码 v4 常量断言 `toMatch(UUID_RE)`，实为「正则匹配输入本身」，未真正对比「序列化落盘形态」；与用例 1 的 `toBe` 语义重叠 | 保留（低成本记录 v4 形态契约）或改为断言「透传后仍满足 v4 形态」并注明其与用例 1 的互补关系；若追求更强，可构造 `resolveModelId(saved)` 与 `saved` 逐字符等价断言（已被用例 1 覆盖） |
| 🟢 P4 | `frontend/src/__tests__/model-loader.test.ts` | 58 | 该文件 mock `resolveModelId: (id?: string) => id ?? 'gen-id'` 对**空串**返回 `''`，与真实行为（空串回退生成 uuid）不一致；当前用例 613 只传非空 id 未触发，但未来若以空串调 `loadPMXFile` 将掩盖真实回退语义 | 将 mock 改为 `(id?: string) => (id && id.length > 0 ? id : 'gen-id')` 或直接 `importOriginal` 透传真实实现，保持与 `model-id.ts:10` 行为同构（同属 stable-identity 决策点一致性） |
| 🟢 P4 | `frontend/src/core/uuid.ts` | 8-13 | `generateUuid` 基于 `Math.random`，非加密安全；碰撞概率理论存在（范围外模块，ADR-193 已接受用于运行时实例 id） | 无需改动；如未来 id 用于权限/鉴权类场景再升级 `crypto.randomUUID`，记录在案即可 |

## 测试质量评价

- **断言有效性**：核心复用语义用 `toBe` 值恒等（用例 1）✅；生成路径用 `UUID_RE` 格式 + 两次生成不相等（用例 3）✅；空串回退断言「匹配 v4 且非空」（用例 4）✅；旧格式废弃用 `startsWith('model_')` 为 false（用例 5）✅。唯一偏弱是用例 2（见风险表 P4）。
- **边界覆盖**：缺省参数 ✅、空串 ✅、重复调用防碰撞 ✅；**未覆盖**：非空非法 uuid / 纯空白字符串透传（P3，与源码同一观察）、运行时传 `null`（TS 签名已排除，实际 falsy 走生成路径，行为正确，可不补）。
- **跳过用例**：无 `it.skip` / `it.todo` / `it.only`（grep 零命中）✅。
- **38 行小文件覆盖充分性**：对单一决策点（1 个三元表达式）5 用例覆盖面充足；恢复路径的**集成**（`loadPMXFile` 将存档 `m.uuid` 作为 preferredId 传入）由 `model-loader.test.ts:613` 覆盖，身份决策与载荷持久化由 `stable-identity-material-roundtrip.test.ts` 覆盖，本文件职责边界定位正确，无越界重复。
- **与材质 roundtrip 测试的关系（ADR-193 闭环）**：`resolve-model-id.test.ts` 验证**身份决策点**——同一存档 uuid 传入必返回同一值（用例 1 `toBe`），保证跨会话 id 恒等；`stable-identity-material-roundtrip.test.ts`（111 行，真实 `material.ts` 函数，非 mock 桩）验证**载荷往返**——`getMatState(id)` 序列化 → 重载 → `applyMatState(id)` 还原，状态不丢（含用例 3 对照演示 pre-fix 易变 id 的孤儿化病因）。两者刻意解耦：roundtrip 测试用硬编码 `'uuid-stable-1'` 而非 `resolveModelId` 输出，避免生成器不确定性；职责上「key 稳定」由本测试保证、「key 稳定下状态可还原」由 roundtrip 测试保证，共同闭合 ADR-193 的「材质/outfit/个人灯按 id 落盘跨会话不丢失」目标。

## 结论细节

- **类型安全**：0 处 `as any` / `@ts-ignore`；签名 `preferredId?: string): string` 干净 ✅
- **异常处理**：纯函数无失败模式、无静默 `catch{}`；空串守卫在决策表达式内 ✅
- **资源释放**：无 `new`/Observer/订阅，不适用 ✅
- **状态流**：单一决策点，无幽灵路径；`grep setState` 不适用（无状态）✅
- **职责单一**：一个函数一个职责（id 解析），不混 UI/持久化 ✅
- **并发安全**：纯函数无共享可变状态，天然可重入 ✅
- **重复代码 / 循环依赖 / 魔法数值**：三者皆无 ✅

---

审核日期：2026-08-15
审核员：子代理 round45-resolve-model-id
