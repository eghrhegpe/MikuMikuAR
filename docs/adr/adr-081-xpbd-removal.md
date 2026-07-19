# ADR-081: XPBD(TS) 测试物理全栈移除与受影响 ADR 审计

> **状态**: 已实施（2026-07-10 经 commit `530af6e` 落地；`go build` / `npm run check` / `vitest` 1206 测试全绿）

## 一、背景与问题

MMD 的**正道物理**是 WASM Bullet（`MmdWasmRuntime` + `MmdWasmPhysics`），模型加载即生效，负责 PMX 自带刚体/裙骨物理。

XPBD(TS) 物理（`xpbd-solver` / `xpbd-cloth` / `xpbd-ragdoll` / `xpbd-collider` / `xpbd-renderer` + `cloth-manager` + `ragdoll-manager`）最初是**测试用**的轻量 TS 求解器。但因其在 `scene.ts` 启动期被 eager `import` 并接线（紧跟 bone-override 之后），且多个 AI 在其上叠加了布料/布偶/调试功能，逐渐被误当作 MMD 加载的「必胜法宝」，导致中央文件（`scene.ts` / `model-manager.ts` / `core/types` / `core/state` / `core/main` / `scene-serialize` / 菜单层 / Go `UIState` / i18n 5 语言包）持续耦合。

**结论**：XPBD 是测试代码被寄生化，应彻底移除，仅保留 WASM MMD 物理。

## 二、决策

彻底移除 XPBD(TS) 全栈；保留 WASM MMD 原生物理 + 风力（`wind-physics.ts`，基于 WASM runtime）+ 物理分类开关（skirt/chest/hair/accessory）+ 碰撞开关（collisionEnabled / bodyCollisionEnabled / groundCollisionEnabled）。

## 三、移除清单

| 类别 | 文件 |
|------|------|
| 求解器/布料/布偶/碰撞/调试 | `physics/xpbd-solver.ts` `physics/xpbd-cloth.ts` `physics/xpbd-ragdoll.ts` `physics/xpbd-collider.ts` `physics/xpbd-renderer.ts` |
| 生命周期管理 | `physics/cloth-manager.ts` `physics/ragdoll-manager.ts` |
| 菜单入口 | `menus/motion-cloth-levels.ts` |
| 测试 | `scene-ragdoll-wiring.test.ts` `xpbd-ragdoll-manager.test.ts` `xpbd-ragdoll.test.ts` `xpbd-sphere.test.ts` `xpbd.test.ts` |
| 中央文件改动 | `scene.ts`(去 `initRagdoll` 接线 + XPBD re-export)、`scene/manager/model-manager.ts`(去 cloth/ragdoll 字段·方法·清理)、`core/state.ts` `core/types.ts`(`EnvState` 去 XPBD 字段)、`core/main.ts`(去 cloth getter/合并)、`scene-serialize.ts`、`menus/scene-menu.ts`、`menus/scene-physics-levels.ts`、`menus/motion-popup.ts` |
| Go 侧 | `internal/app/app.go` `UIState` 去 `ClothConfig` 等；`npm run generate:bindings` 重生成（116 方法不变） |
| i18n | 5 语言包 `physics.*` 键清理 + 测试 fixture |

## 四、随之消失的功能（无 WASM 等价）

1. **可挂载布料**（capes/裙摆附加件）：babylon-mmd WASM 仅模拟 PMX 自带裙骨，不支持运行时附加布料。
2. **布偶瘫倒**（ragdoll drop）：WASM 为常驻刚体追随，无「一键瘫倒 / 物理接管」开关。

## 五、保留的可复用基础设施

抽取与物理后端无关的 `physics/physics-bridge.ts`（**不被启动期 eager 导入**）：
- 骨骼 READ 桥（`findRuntimeBone` / `getBoneWorldMatrix` / `getBoneWorldPosition`）
- `autoFitAttachment()` 几何 fit（纯数学）
- `PerFrameUpdateRegistry` 每帧调度（抽取 XPBD 重复的 observer 编排）

将来若在 WASM 之上复活挂载布料/布偶，直接复用此模块，避免重现寄生加载主链。

## 六、受影响 ADR 审计（共 15 个）

> 注：原人工审计列 13 个，**实际为 15 个**——`adr-033`（依赖图含 `ClothConfig`）与 `adr-059`（i18n 迁移清单含 `cloth-manager`/`ragdoll-manager`/`motion-cloth-levels`）亦含 XPBD 引用，已一并校正。

### 核心依赖（7，功能已失效 → 废弃/失效说明）
| ADR | 标题 | 处置 |
|-----|------|------|
| `adr-019` | XPBD 布料模拟引擎选型 | ⚠️ 整篇废弃 |
| `adr-029` | 物理 UI 重构（布料/WASM 分治） | ⚠️ 部分失效（XPBD 子页移除，WASM 入口保留） |
| `adr-054` | 后续开发路线图 | 📌 路线图修订（Mesh-to-Cloth / Ragdoll 项失效） |
| `adr-061-advanced-bone-systems` | 高级骨骼系统 | 📌 Ragdoll 章节失效，其余四项有效 |
| `adr-061.1-ragdoll-fidelity` | Ragdoll 保真度提升 | ⚠️ 整篇废弃 |
| `adr-061.1-plan` | Ragdoll 实施计划 | ⚠️ 整篇废弃（源码已删） |
| `adr-056` | WASM 运行时 Motion Layers | 📌 能力矩阵 XPBD 行失效，本体有效 |

### 次要提及（6，校正引用，不影响架构）
| ADR | 说明 |
|-----|------|
| `adr-028` | 风场统一：XPBD 布料风场力子章节失效，风力现仅 WASM + 环境 |
| `adr-033` | 配置分裂依赖图含 `ClothConfig` / `DEFAULT_CLOTH_CONFIG` |
| `adr-047` | 配置持久化含 `clothConfig` 字段与防抖修复 |
| `adr-059` | i18n 迁移清单含 `cloth-manager` / `ragdoll-manager` / `motion-cloth-levels` |
| `adr-060` | E2E 策略含 xpbd 测试、`particleCount` / `constraintCount` |
| `adr-079` | 感知层引用 `xpbd-ragdoll.ts` 分层注释 |

### 仅引用（2，文案清理，无功能影响）
| ADR | 说明 |
|-----|------|
| `adr-030` | 小说目录重组中 XPBD 布料为例举 |
| `adr-044` | 竞品分析特性列表含 XPBD 布料 |

## 七、验证

- `go build ./...` → exit 0
- `npm run check`（tsc）→ 0 error
- `npx vitest run` → 1206 测试全过（XPBD 测试已删）
- `docs/adr/` XPBD 残留扫描 → 15 个 ADR 均加注释，源码 `frontend/src` + `bindings` 无 XPBD 符号
