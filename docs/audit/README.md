# MikuMikuAR 代码审核总索引

> 审核周期: 2026-07
> 审核范围: `frontend/src/` 核心3D渲染模块（环境、光照、运动图层、播放、感知）
> 方法: 按 AGENTS.md 审核流程，5维度 + 心理模拟逐模块走查

---

## 执行摘要

9轮审核覆盖 **41个模块**，总体结论如下：

| 结论 | 模块数 | 说明 |
|------|--------|------|
| ✅ 通过 | 13 | 无结构性问题，可直接用于生产 |
| ⚠️ 有条件通过 | 22 | 存在 P2-P4 问题，建议修复后再上线 |
| ❌ 不通过 | 5 | 存在 🔴P1 问题，必须修复 |

### 不通过模块（必须修复）

| 模块 | 文件 | 🔴P1 问题 |
|------|------|-----------|
| 环境水面 | `env-water.ts` | L979 `getScene()` 无 null guard（可能抛 NPE） |
| 光照系统 | `lighting.ts` | `transitionLighting` animLoop 定义后未调度；`_tweenValue` 用 `addOnce` 只注册一帧；零实质测试 |
| 程序化自动舞蹈 | `proc-motion-autodance.ts` | 540 行超 250LOC 天花板；零测试；正弦表未预分配产生 undefined |
| 感知系统 | `perception.ts`（原始） | `activatePerception` 跳过检测逻辑漏洞；实时渲染路径零测试（**已修复 → 拆分后 ✅**） |

---

## 风险全景图

### 按优先级分布

| 级别 | 数量 | 影响域 |
|------|------|--------|
| 🔴 P1 | 7 | 运行时崩溃、功能静默不执行、零测试 |
| 🟠 P2 | 18 | 类型安全违规、超限模块、无 dispose 入口、渲染副作用 |
| 🟡 P3 | 24 | 非空断言、GC 压力、循环依赖、状态来源不单一 |
| 🟢 P4 | 9 | 编码一致性、注释补充 |

### 跨模块模式问题

| 模式 | 出现次数 | 涉及模块 |
|------|----------|----------|
| `as any` / 双重 cast | 11 | water, facade, lighting, loader, layers, blender |
| `canvas.getContext('2d')!` 非空断言 | 4 | particles, facade, terrain, water... |
| `_scene!` / `getScene()!` 非空断言 | 8 | water, lighting, layers, blender, bone-override |
| 零测试覆盖 | 13 | clouds, particles, facade, lighting, props, loader, layers, blender, idle, autodance, lifelike, bridge, bone-override |
| 250LOC 超限 | 5 | lighting(1229), layers(611), autodance(540), perception(1155), bridge(448) |
| 循环依赖 | 3 | facade↔water, blender↔scene(still active), perception↔scene |

---

## 审核轮次速查

| 轮次 | 模块 | 文件 | 结论 | 报告 |
|------|------|------|------|------|
| ① | 环境水面 | `env-water.ts` | ⚠️ 有条件通过 | [查看](round-1-water.md) |
| ② | 环境云 | `env-clouds.ts` | ⚠️ 有条件通过 | [查看](round-2-clouds-particles.md) |
| ② | 环境粒子 | `env-particles.ts` | ⚠️ 有条件通过 | ↑ |
| ③ | 环境门面 | `env-impl.ts` | ⚠️ 有条件通过 | [查看](round-3-facade-terrain.md) |
| ③ | 环境地形 | `env-terrain.ts` | ⚠️ 有条件通过 | ↑ |
| ④ | 光照系统 | `lighting.ts` | ❌ 不通过 | [查看](round-4-lighting-props.md) |
| ④ | 光照预设 | `lighting-presets.ts` | ⚠️ 有条件通过 | ↑ |
| ④ | 环境光照 | `env-lighting.ts` | ✅ 通过 | ↑ |
| ④ | 道具 | `props.ts` | ⚠️ 有条件通过 | ↑ |
| ⑤ | VMD加载器 | `vmd-loader.ts` | ⚠️ 有条件通过 | [查看](round-5-vmd-layers.md) |
| ⑤ | VMD图层 | `vmd-layers.ts` | ⚠️ 有条件通过 | ↑ |
| ⑤ | WASM图层混合 | `wasm-layers-blender.ts` | ⚠️ 有条件通过 | ↑ |
| ⑤ | 图层配置 | `wasm-layers-config.ts` | ✅ 通过 | ↑ |
| ⑤ | VMD求值器 | `vmd-evaluator.ts` | ✅ 通过 | ↑ |
| ⑥ | 播放控制 | `playback.ts` | ✅ 通过 | [查看](round-6-playback-procedural-perception.md) |
| ⑥ | VMD写入器 | `vmd-writer.ts` | ✅ 通过 | ↑ |
| ⑥ | 节拍检测 | `beat-detector.ts` | ✅ 通过 | ↑ |
| ⑥ | 唇形同步 | `lipsync.ts` | ✅ 通过 | ↑ |
| ⑥ | 空闲程序化运动 | `proc-motion-idle.ts` | ⚠️ 有条件通过 | ↑ |
| ⑥ | 程序化自动舞蹈 | `proc-motion-autodance.ts` | ❌ 不通过 | ↑ |
| ⑥ | 逼真程序化运动 | `proc-motion-lifelike.ts` | ⚠️ 有条件通过 | ↑ |
| ⑥ | 程序化桥接 | `proc-motion-bridge.ts` | ⚠️ 有条件通过 | ↑ |
| ⑥ | 共享程序化逻辑 | `proc-motion-shared.ts` | ✅ 通过 | ↑ |
| ⑥ | 感知系统 | `perception.ts` | ✅ 通过（拆分后 10 文件全绿） | ↑ |
| ⑥ | VPD解析器 | `vpd-parser.ts` | ✅ 通过（测试覆盖佳） | ↑ |
| ⑦ | WASM图层混合(追审) | `wasm-layers-blender.ts` | ⚠️ 有条件通过 | [查看](round-7-wasm-bone-override.md) |
| ⑦ | 骨骼覆盖 | `bone-override.ts` | ⚠️ 有条件通过 | ↑ |
| ⑦ | scene.ts WASM集成 | `scene.ts` (WASM部分) | ✅ 通过 | ↑ |
| ⑧ | 感知层拆分 | `perception.ts` (共10文件) | ✅ 通过 | [查看](round-8-perception-split.md) |
| ⑨ | 镜面反射 | `env-water.ts`, `env-impl.ts`, `renderer.ts` | ⚠️ 有条件通过 | [查看](round-9-mirror-reflection.md) |

---

## 改进优先级建议

### ⚡ 立即修复（P1）

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 1 | `lighting.ts` `transitionLighting` 未调度 → 灯光过渡静默不执行 | 用户调灯光预设无过渡效果 |
| 2 | `env-water.ts` `disposeWater` `getScene()` 无 null guard | dispose 后再次调用抛 NPE |
| 3 | `proc-motion-autodance.ts` 零测试 + 超限 + undefined 问题 | 运行时可能产生错误骨骼帧 |
| 4 | `bone-override.ts` `MmdRuntimeBoneExtended` 接口重复定义 | 修改一处需手动同步另一处 |

### 📋 短期改进（P2）

| 问题 | 涉及模块 |
|------|----------|
| 补充 `as any` 安全性注释 | water, facade, lighting, loader, layers |
| 添加 dispose 统一清理入口 | lighting.ts（缺少 `disposeLighting()`） |
| 拆分超限模块（>250LOC） | lighting, layers, bridge, autodance |
| 水面反射 BFC 恢复（`onAfterRenderObservable` 缺失） | env-water.ts（P2.1，影响所有材质网格性能+正确性） |
| 水面/地面 renderList 每帧重建（应加脏标记） | env-water.ts, env-impl.ts（性能隐患） |
| 添加核心零测试模块的基础测试 | clouds, particles, facade, loader, layers, blender |

### 🔧 持续改进（P3）

| 问题 | 涉及模块 |
|------|----------|
| 修复循环依赖 | facade↔water, blender↔scene |
| 非空断言加 guard | 全模块 canvas.getContext, _scene |
| 优化 GC | particles splash `new Vector3` 每帧 |

---

## 审核标准参考

- 审核执行标准见 `AGENTS.md` → `# 审核代码可用性`
- ADR 参考: ADR-051(图层), ADR-052(地面), ADR-056(WASM), ADR-083(地面架构)
- 术语规范: `docs/terminology.md`
