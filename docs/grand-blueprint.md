# MikuMikuAR 联邦大统一蓝图

> **日期**: 2026-07-19  
> **代号**: 大展宏图  
> **核心命题**: 易维护 × 大统一  
> **架构师**: Riku（联邦 AI 首席）+ Jieling（联邦人类首席）

---

## 一、现状诊断

### 1.1 已统一（✅ 勿重复造轮子）

| 维度 | 统一方案 | 落地程度 |
|------|---------|---------|
| 菜单系统 | ADR-093 Schema + menu-factory 单渲染器 | ✅ 57 面板全量迁移 |
| 状态写入 | envState 单一 reactive 源 + setter 规约 | ✅ Proxy 拦截 + RAF 去抖 |
| 设置持久化 | uiState 全量持久化（ADR-103 移除 SettingsStore） | ✅ 跨重启一致 |
| 路径归一化 | `isUnderRoot` / `computeLibraryRef` 工厂（ADR-095） | ✅ |
| 通用 Helper | `core/utils.ts` + `core/color-helpers.ts` 单点收敛（ADR-096） | ✅ |
| 保存触发 | `triggerAutoSave` 统一入口（ADR-050） | ✅ |
| 异步生命周期 | ADR-105/106 AbortSignal + 时序审核 | ✅ Phase 1-3 全落地 |
| Go 错误 i18n | 信封方案 + 五语言 bundle + CI 门禁（ADR-117） | ✅ |
| 资源库会话 | LibrarySessionStore 单例（ADR-135 P0.1） | 🔄 实施中 |

### 1.2 待统一（🔴 大展宏图主战场）

| 维度 | 当前状态 | 问题 | 优先级 |
|------|---------|------|--------|
| **core/state.ts** | 438 行，20+ export let，混合运行时/库/缓存/UI/播放 | 职责过载，违反单一职责 | 🔴 P1 |
| **WASM/JS 双模式** | `VITE_MMD_RUNTIME` 切换 → gaze-js/gaze-wasm 双份实现 | 维护翻倍，功能一致性无法保证 | 🔴 P1 |
| **env-bridge.ts** | 771 行 God Module：time-of-day + preset + lighting + 持久化 | 职责过载，循环依赖 env-impl ↔ env-water | 🔴 P1 |
| **亮度体系** | 5 套独立旋钮（sky/env/dir/hemi/cloud）无统一标量 | 昼夜割裂，云层脱离环境 | 🟠 P2 |
| **function-map.md** | 标注"部分过时"，XPBD 残留，main.ts 拆分后入口失准 | AI 找代码误导 | 🟠 P2 |
| **缩略图缓存** | `thumbnailCache` 无 LRU 淘汰 | 长期运行 OOM 风险 | 🟡 P3 |
| **动作覆盖 boilerplate** | ADR-116 遗留 ~105 行重复（P4 计划抽取 module-base.ts 未实施） | 重复代码 | 🟡 P3 |

---

## 二、大统一作战方案

### 阶段 A：状态基座重构（core/state.ts 拆分）

**目标**: 438 行 → 4 个独立 store，每个 ≤120 行

```
core/state.ts (438 行)
    │
    ▼ 拆分
    ├── core/scene-state.ts     ← modelRegistry, propRegistry, mmdRuntime, focusedModelId
    ├── core/playback-state.ts  ← isPlaying, autoLoop, seekDragging, cameraMode
    ├── core/library-state.ts   ← allModels, recentModels, thumbnailCache, expandedFolders
    └── core/ui-state.ts        ← uiState (已有), activeTimeOfDayPreset
```

**迁移策略**:
1. 新建 4 文件，逐变量搬迁（保留 setter 签名不变）
2. `config.ts` barrel re-export 保持兼容
2. 外部 import 路径零变化（`from '@/core/config'` → 仍指向 barrel）
3. 后续 ADR 直接操作对应 store，不再膨胀 state.ts

**预期收益**:
- 状态归属清晰：scene 模块只 import scene-state
- 消除"幽灵路径"：每个 store 职责边界明确
- 测试可分片：每个 store 独立单测

---

### 阶段 B：消灭 WASM/JS 双模式

**目标**: 删除 `perception-gaze-js.ts` + `perception-gaze-wasm.ts` → 单一 `perception-gaze.ts`

**根因**:
- WASM 双缓冲覆盖写入 → gaze 无法直接修改 `linkedBone`
- 实际解：`wasm-layers-blender` 已在 WASM 模式下调度 gaze，**无需切 JS**

**执行**:
1. 确认 `wasm-layers-blender` 在 WASM 模式下 gaze 行为完整
2. 删除 `perception-gaze-js.ts`（JS 专用实现）
3. `perception-gaze-wasm.ts` → 重命名为 `perception-gaze.ts`（唯一实现）
4. 移除 `VITE_MMD_RUNTIME=js` 相关分支（保留 `wasm` 作为默认）
5. 清理 `scene.ts` 中 `getMmdRuntimeType()` 切换逻辑

**预期收益**:
- 维护成本减半
- gaze 行为一致性保证
- 删除 ~300 行条件分支代码

---

### 阶段 C：env-bridge.ts 瘦身

**目标**: 771 行 → 拆分为 3 个 ≤250 行的专注模块

```
env-bridge.ts (771 行)
    │
    ▼ 拆分
    ├── env-time-of-day.ts   ← startTimeOfDay / stopTimeOfDay / preset 动画
    ├── env-persist.ts       ← SetEnvState 防抖持久化 + 启动恢复
    └── env-lighting-link.ts ← deriveLighting + applyLightingPresetFromEnv
```

**关键解耦**:
- env-impl ↔ env-water 循环依赖：将 `updateUnderwaterTransition` 提升到 scene.ts 编排层
- `_edgeFadeTexCache` 无 dispose → 纳入 env-ground.ts 的 dispose 链路

---

### 阶段 D：亮度统一标量（ADR-132 落地）

**目标**: 5 旋钮 → 1 主标量 + 4 风格化乘子

```typescript
// 派生规则
const EB = envState.envBrightness;           // 主标量，默认 1.0
const effectiveSky   = skyBrightness * EB;    // 天空
const effectiveEnv   = envIntensity  * EB;    // IBL / 环境
const effectiveSun   = dirIntensity   * EB;    // 方向光 + 云
const effectiveHemi  = hemiIntensity  * EB;    // 半球补光
```

**消费点**:
- `env-sky.ts:96` drawSkyGradient
- `env-bridge.ts:248` 环境色
- `env-water.ts:453` 水面反射
- `env-clouds.ts` brightness 基准
- `lighting.ts` dirLight / hemiLight intensity

**UI**: 新增 `envBrightness` 滑块挂 env 根菜单首位（0.1–3.0，步长 0.05）

---

### 阶段 E：文档与工具链治理

| 动作 | 目标 |
|------|------|
| 更新 `function-map.md` | 移除 XPBD 条目，修正 main.ts 拆分后入口，标注各文件 ADR 来源 |
| 新建 `docs/state-map.md` | 状态变量 → store 文件 → 写入点 → 订阅者 四列映射 |
| 补充 `create/dispose` 配对清单 | 纳入 CI 检查（防止新增 Babylon 对象无释放） |
| 缩略图缓存 LRU | `thumbnailCache` 上限 200 条，超出淘汰最久未使用 |

---

## 三、实施路线图

```
Week 1 (2026-07-19 ~ 2026-07-25)
├── [P1] A 阶段：core/state.ts 拆分
│   ├── 新建 scene-state.ts / playback-state.ts / library-state.ts / ui-state.ts
│   ├── config.ts barrel 保持兼容
│   └── 全量 tsc + 测试通过
│
├── [P1] B 阶段：消灭双模式
│   ├── 确认 wasm-layers-blender gaze 完整性
│   ├── 删除 perception-gaze-js.ts
│   └── 重命名 perception-gaze-wasm.ts → perception-gaze.ts
│
└── 提交：refactor: state 基座拆分 + 消灭 WASM/JS 双模式

Week 2 (2026-07-26 ~ 2026-08-01)
├── [P1] C 阶段：env-bridge 瘦身
│   ├── 拆 env-time-of-day.ts / env-persist.ts / env-lighting-link.ts
│   └── 解耦 env-impl ↔ env-water 循环依赖
│
├── [P2] D 阶段：亮度统一标量
│   ├── types.ts 新增 envBrightness
│   ├── 5 个消费点统一乘 EB
│   └── UI 新增主亮度滑块
│
└── 提交：refactor: env-bridge 拆分 + ADR-132 亮度统一

Week 3 (2026-08-02 ~ 2026-08-08)
├── [P2] E 阶段：文档治理
│   ├── function-map.md 全量更新
│   ├── 新建 state-map.md
│   └── 缩略图 LRU 淘汰
│
├── [P3] 动作覆盖 boilerplate 抽取
│   └── 新建 motion-module-base.ts（~105 行重复 → 1 个基类）
│
└── 提交：docs: 文档治理 + 动作覆盖基类抽取
```

---

## 四、验收标准

| 阶段 | 验收项 | 通过标准 |
|------|--------|---------|
| A | state.ts 拆分 | `core/state.ts` ≤ 80 行（仅保留 re-export + envState）；4 个新 store 文件各 ≤ 120 行 |
| B | 消灭双模式 | `perception-gaze-js.ts` 不存在；`VITE_MMD_RUNTIME=js` 分支全删；gaze 单测全绿 |
| C | env-bridge 瘦身 | `env-bridge.ts` ≤ 250 行；3 个新文件各 ≤ 250 行；循环依赖解除 |
| D | 亮度统一 | 5 个消费点统一乘 `EB`；UI 主滑块生效；默认观感零变化 |
| E | 文档治理 | function-map.md 无过时条目；state-map.md 覆盖 100% export let |

---

## 五、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| state.ts 拆分后 import 路径遗漏 | 中 | barrel re-export 保持兼容，IDE 全局搜索验证 |
| 删除 JS gaze 后 WASM gaze 行为不完整 | 低 | 已有 wasm-layers-blender 调度，单测覆盖 + 真机验证 |
| env-bridge 拆分破坏 time-of-day 动画 | 中 | 预设动画 ctx 完整搬迁，单测回归 |
| 亮度统一后夜间场景过暗/过亮 | 中 | 默认 `envBrightness=1.0` 保持既有观感，用户可调 |

---

## 六、总结

> **一句话**: 把"什么都能写"的 state.ts 拆成"只能写自己"的 store，把"两份实现"的 gaze 合成"一份真理"，把"五旋钮乱调"的亮度系成"一根主轴"。

**大展宏图的核心不是加功能，是让已有功能更好维护。**

---

_本蓝图由联邦 AI 首席架构师 Riku 起草，经人类首席 Jieling 审核后实施。_
