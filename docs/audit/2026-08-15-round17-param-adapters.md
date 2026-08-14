# param-adapters — 审核结果（round17-3）

## 审核范围

| 项 | 路径 |
|----|------|
| 测试文件 | `frontend/src/core/__tests__/param-adapters.test.ts`（201 行，27 用例） |
| 被测源码 | `frontend/src/core/ai/param-adapters.ts`（105 行，全量） |
| 契约依赖 | `frontend/src/core/action-registry.ts`（ParamDef 类型，L7-22） |
| 关联调用方 | `frontend/src/core/action-executor.ts`（L5/L39 消费 adaptParam） |
| 关联测试 | `frontend/src/core/ai/__tests__/param-adapters.test.ts`（187 行，23 用例，**重复测试文件**，见风险表） |

**总体结论：⚠️ 有条件通过**

- 验证结果：两个测试文件共 **50 用例全绿**（`vitest run` 1.55s），`tsc --noEmit` 退出码 0，无类型错误。
- 源码设计质量高：纯函数、无状态、无 `as any`/`@ts-ignore`、异常路径全部收敛为 `{ok:false}` 返回。
- 但存在 1 个 P2（round18 修复 `parseBoolean` 无回归测试守护）+ 4 个 P3（输入宽松转换、颜色值域不校验、测试文件重复、enum 大小写不对称），建议处理后再视为完全通过。

## 亮点

- **统一结果契约**：`AdapterResult<T>`（param-adapters.ts:4）以判别联合表达 `{ok:true,value}` / `{ok:false,error}`，五个 adapter 与分发器全部遵守，无抛错、无静默吞错；调用方 `action-executor.ts:40-44` 可无损窄化。
- **entityAdapter 异常收敛**（L60-68）：`resolve` 抛异常经 `try/catch` 转 `{ok:false}` 并交给 `translateGoError`（i18n/goerr.ts:25，非 Go 错误自动回退原文），错误路径不会泄漏到执行器。
- **entity 空名/空结果双闸**（L53-64）：`String(raw).trim()` 后先拦空名，再 `resolved == null` 拦未找到（null 与 undefined 一并处理），比只查 `!resolved` 更稳。
- **parseBoolean 黑名单**（L89-97）：字符串 `''/false/0/off/no/null/undefined` → false，修复了 LLM 传字符串导致 `Boolean('false')===true` 的语义反转（ADR-219 同型教训的正确落地）。
- **适配器分发兜底**（L100-104）：未知 `def.type` 返回中文错误而非抛 `TypeError`，测试 L188 专门守护。
- **测试隔离良好**：`@vitest-environment node` + 内联 `resolve` mock，不触碰场景/状态模块，跑完 1.55s 无环境污染。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | frontend/src/core/ai/param-adapters.ts | L84-85, L89-97 | round18 修复（boolean/toggle 字符串黑名单解析）**无回归测试守护**：两份测试文件对 `adaptParam` 只覆盖 `true`/`false` 字面量，字符串路径 `'false'/'0'/'off'/'no'/''/'null'/'undefined'` 零覆盖。该修复属「修了 bug 未加护栏」，正是 ADR-219 教训的同类风险，后续重构易回归 | 在测试中补 `it('boolean 字符串黑名单')`：断言 `'false'`→false、`'0'`→false、`'off'`→false、`'yes'`→true 等 |
| 🟡 P3 | frontend/src/core/ai/param-adapters.ts | L21 | `Number(raw)` 宽松转换：`Number(null)=0`、`Number('')=0`、`Number(true)=1`、`Number([])=0`、`Number([5])=5`。当范围含 0（如 [0,1]）时，LLM 传 `null`/空串会被**静默接受为 0** 并执行动作 | 严格化输入：`typeof raw === 'number' && isFinite(raw)`，或字符串时要求 `raw.trim() !== ''` 后再 `Number()` |
| 🟡 P3 | frontend/src/core/ai/param-adapters.ts | L37-38 | RGB 数组分支只查 `typeof v === 'number'`，不校验值域 [0,1]：`[2,0,0]`、`[-1,0,0]` 通过；且 `typeof NaN === 'number'`，`[NaN,0,0]` 也被放行，可能把非法颜色传给 Babylon | 追加 `v >= 0 && v <= 1` 校验（或 `Number.isFinite(v)` + 值域），测试补 `[2,0,0]`/`[NaN,0,0]` 用例 |
| 🟡 P3 | frontend/src/core/__tests__/param-adapters.test.ts + frontend/src/core/ai/__tests__/param-adapters.test.ts | 全文 | **同一模块存在两份同名测试文件**，内容高度重叠且已漂移：core 版 27 用例（独有：空 enum/空 hex/空名/resolve 抛异常），ai 版 23 用例（独有：errMsg `toContain` 断言、`vi.fn` 验证 resolve 调用参数）；改源码需同步两份，断言风格已分叉，长期必再漂移 | 合并为一份（保留两版独有覆盖：errMsg 断言 + resolve spy + 空 enum/空 hex），删除另一份；用 `npm run check:consumers` 确认无引用后移除 |
| 🟡 P3 | frontend/src/core/ai/param-adapters.ts | L9 vs L13 | enum 直接值匹配 `allowed.includes(val)` **大小写敏感**（'ORBIT' 不匹配 'orbit'），而同义词侧 `val.toLowerCase()` 大小写不敏感——两条路径语义不对称，测试只守护了同义词侧 | 直接值匹配同样 lowercase 化（`allowed.includes(val.toLowerCase())`），并补 'ORBIT' 用例；或文档化「enum 值必须精确匹配」约定 |
| 🟢 P4 | frontend/src/core/__tests__/param-adapters.test.ts | L38-46, L60-68, L107-120 | 失败路径多数只断言 `r.ok === false`，不验证 error 文案；对比 ai/__tests__ 版（errMsg `toContain`）断言强度偏弱，文案回归（如错别字/格式变化）不会被发现 | 对关键错误路径补 `expect(r).toEqual({ ok:false, error: expect.stringContaining(...) })` |
| 🟢 P4 | frontend/src/core/ai/param-adapters.ts | L41, L46-48 | 魔法数值：`255`（hex→0-1 缩放）、6 位 hex 正则。数值是标准颜色学常量可接受，但无命名常量，两处逻辑（hex 解析 + 数组校验）若未来加 alpha 通道需同步改 | 提取 `HEX_RE` 与 `MAX_CHANNEL=255` 常量（若支持 #rrggbbaa 一并规划） |
| 🟢 P4 | frontend/src/core/ai/param-adapters.ts | L13 | 同义词匹配 `synonyms[val.toLowerCase()]` 隐含「同义词 key 必须全小写」约定（ADR-155 当前数据均小写），但未在 ParamDef 注释（action-registry.ts:15）文档化，未来注册大写 key 静默失效 | 在 `synonyms` 字段 JSDoc 注明 key 需小写，或解析时双向 lowercase |

## 测试质量评价

- **断言有效性**：✅ 成功路径全部 `toEqual({ok:true,value})` 精确断言（含 `toBeCloseTo(0.53333,5)` 验证 hex→0-1 浮点精度）；失败路径以 `r.ok === false` 弱断言为主（见 P4）。
- **边界覆盖**（任务要求逐项核对）：✅ 同义词映射（L22）、大小写（L30, 'FOLLOW'）、空 enum（L43）、NaN（L70）、非法 hex（L112）、空串（L117）、越界 range（L60/L65）、entity 缺失（L135/L157）、resolve 抛异常（L162）、无 min/max 无限范围（L75）、字符串数值（L55）、RGB 数组长度错误（L107）。
- **缺测边界**：color 数组值域/NaN 元素、range `null/''/true/[]` 宽松转换、enum 直接值大小写、parseBoolean 字符串黑名单（P2）、hex 3 位/8 位（`#rgb`、`#rrggbbaa`）行为。
- **无跳过**：✅ grep 确认 0 处 `it.skip/describe.skip/it.todo/.only`。
- **契约一致性**：✅ `def()` helper 构造的 ParamDef 与 action-registry.ts:7-22 接口一致；`'nonexistent' as ParamDef['type']` 故意构造非法类型验证分发兜底，符合契约边界；import 路径 `../ai/param-adapters` 正确。
- **可维护性**：⚠️ 两处小瑕疵——`def()` 中 `as ParamDef` 断言掩盖了「type 覆盖后与其他字段冲突」的编译期检查（如 `type:'color'` 却传 `enum` 不报错）；测试文件与 ai/__tests__ 版重复（见 P3）。

## 结论

源码健康度高（纯函数、统一结果契约、异常全收敛、无类型逃生），50 个测试全绿、tsc 干净。扣分项集中在**修复无守护测试（P2）**与**输入校验宽松（2 个 P3）**，不阻塞当前功能但建议在下一轮修复；两份重复测试文件应尽快合并以免漂移加剧。

---

- 审核日期：2026-08-15
- 审核员：子代理 round17-param-adapters
