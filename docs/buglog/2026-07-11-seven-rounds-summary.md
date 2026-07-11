# 七轮代码审核汇总（2026-07-11）

覆盖范围：环境 / 光照 / VMD / 程序化动作 / 感知 / WASM 混合 共 30+ 模块。

---

## 已修复问题索引

| 轮次 | Buglog 文件 | 核心修复 |
|------|------------|---------|
| ① | env-water-setWorldMatrix.md | `setWorldMatrix`/`freezeWorldMatrix` 不在 FreeCamera 继承链——调用不存在方法的潜伏 BUG |
| ② | env-particles-clouds-audit.md | `getContext('2d')!` 守卫 / Vector3 复用 / 冗余 observer / instanceof 守卫 |
| ③ | env-impl-terrain-audit.md | edgeFadeTex 缓存泄漏 / getContext guard ×3 / 除零守卫 |
| ④ | lighting-tween-bugs.md | transitionLighting animLoop 未调度 / _tweenValue 单帧中断 / disposeLighting |
| ⑤ | vmd-layers-type-comments.md | 5 处双重 cast 安全注释 |
| ⑥ | perception-writeMatToBuffer.md | `_writeMatToBuffer` for 循环 → `buf.set()` memcpy |
| ⑦ | MmdRuntimeBoneExtended-dedup.md | `MmdRuntimeBoneExtended` 接口去重 + autodance re-export 修复 |

---

## 未修复（需后续跟进）

| 严重度 | 问题 | 模块 |
|--------|------|------|
| 🔴 P1 | 零测试覆盖 | env-clouds / env-particles / bone-override / vmd-layers / wasm-layers-blender 核心逻辑 |
| 🟠 P2 | 超大模块（>250 LOC） | lighting.ts (1229) / perception.ts (1155) / proc-motion-autodance.ts (540) / vmd-layers.ts (611) |
| 🟠 P2 | 实时渲染路径零测试 | perception.ts gaze/breathing/blink |
| 🟡 P3 | 循环依赖 | scene.ts ↔ wasm-layers-blender.ts ↔ perception.ts |
| 🟡 P3 | 对象池非线程安全 | perception.ts `_v3()`/`_m()`/`_q()` 下标竞争 |

---

## 统计

- **修复 BUG**: 3 个功能 BUG（animLoop 未调度 / _tweenValue 单帧 / setWorldMatrix 不存在）
- **新增函数**: `disposeLighting()` 统一清理入口
- **消除泄漏**: `_edgeFadeTexCache` 缓存未释放
- **消除 `as any`**: 5 处替换为类型安全写法或精确注释
- **消除 `!` 非空断言**: 5 处 `getContext('2d')!` 替换为 null guard
- **接口去重**: `MmdRuntimeBoneExtended` 从 2 个文件合并到 `core/types.ts`
- **性能优化**: `_writeMatToBuffer` memcpy / splash Vector3 复用
