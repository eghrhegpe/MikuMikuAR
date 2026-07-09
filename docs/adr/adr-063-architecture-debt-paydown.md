# ADR-063: 架构债务清偿（精简版）

> **状态**: ✅ 已实施（2026-07-08，build+1128 tests 通过）
> **关联**: ADR-033（配置拆分去重）、ADR-022（预设治理）、ADR-055（AR 相机模式）

---

## D1 — EnvState 三层对齐

| 问题 | 三层定义（Go/binding/前端）字段数不一致，双转义静默丢数据 |
|------|------|
| 决策 | **Go struct 为唯一真源，前端被动跟随** |
| 要点 | 字段标准=「能否影响场景呈现」，不以「Go 是否消费」判断；删除废弃 `FoamAlphaInfluence`；契约测试防漂移 |

---

## D2 — App struct 拆分

| 问题 | 136 方法上帝对象，单测困难 |
|------|------|
| 决策 | **Facade 薄包装 + 渐进式分包**（Wails 绑定约束下的务实选择） |
| 判断标准 | App 方法超 10 行含业务逻辑 → 拆出到子包 |
| 依赖模式 | 纯逻辑函数依赖注入；有状态系统包级单例+init |
| 已完成（第一批） | `internal/dialogs/`（7 方法）、`internal/thumbnail/`（4 方法）、`internal/util/hash.go` |
| 待完成 | 预设管理（~15）、模型库（~20）、ZIP 解压、HTTP 服务器、文件监听 |

---

## D3 — scene.ts 职责边界

| 问题 | 既是编排器又是函数容器，职责模糊 |
|------|------|
| 决策 | **纯领域逻辑搬出，跨子系统协调留在 scene.ts** |
| 函数去向 | `focusedMmdModel` / `focusedModel` → `manager/model-ops.ts` |
| | `setARMode` / `takeARScreenshot` / `isARModeActive` → `ar/ar-scene.ts`（新建） |
| | `applyFrameControl` 留 scene.ts（UI→引擎胶水，7 行） |
| | `initScene` / `getScene` 留 scene.ts（组装器+barrel 正当职责） |
| 循环依赖 | barrel re-export 型循环可接受，非业务逻辑互调 |

**结果**: scene.ts 自有函数从 8 个降至 3 个。

---

## 经验教训

1. **类型一致性必须有测试兜底**，光靠代码审查防不住字段漂移
2. **渐进式重构优于大爆炸**，每步可 build+test 验证
3. **框架约束下 Facade 是务实选择**，Wails 绑定要求方法挂在 App 上
4. **编排层是跨子系统协调的正当位置**，不要为"barrel 纯化"而硬拆