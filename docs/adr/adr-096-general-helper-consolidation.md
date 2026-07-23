# ADR-096: 通用 Helper 单点收敛

> **日期**: 2026-07-13
> **状态**: 已完成
> **关联**: ADR-095（路径归一化收敛，同批次 helper 清理）、ADR-085（feet-adjustment 数学 helper）、ADR-064（scene↔outfit 解耦，getBaseName 复用基础）
> **影响面**: `frontend/src/core/utils.ts`、`frontend/src/core/color-helpers.ts`（新建）、`frontend/src/core/main.ts`、`frontend/src/menus/settings-shared.ts`、`frontend/src/scene/{env,render,camera,scene-serialize,scene-bundle}`、`frontend/src/outfit/outfit.ts`、`frontend/src/scene/render/performance.ts`

---

## 问题

ADR-095 收敛路径 helper 时，顺带扫描出**一批散落、重复、语义等价的通用 helper**：

| # | 重复实现 | 散落位置 | 问题 |
|---|---------|---------|------|
| 1 | `clamp` / `clampInt` / `clamp01` | renderer、physics-bridge、feet-adjustment-math、skirt-analyzer、camera(clampFov) | 5+ 套手写 clamp，签名/语义不一 |
| 2 | `lerp` / `lerpArray` | renderer、env-bridge | 匿名箭头 `const lerp = (a,b)=>a+(b-a)*t` 局部声明 |
| 3 | `new Color3(arr[0],arr[1],arr[2])` | env-impl(7)、env-water(4)、env-bridge(1)、lighting(6)、outfit(1) | 19 处三元组构造，无单点入口 |
| 4 | `JSON.parse(JSON.stringify(x))` | scene-bundle:102、camera:1021/1043 | 手写深拷贝，未命名 |
| 5 | `function _ts()` / `logTime()` 时间戳 | main、env-bridge、performance | 3 套 `new Date()` + padStart 重复实现 |
| 6 | `debounce` 手动防抖 | camera(scheduleCameraPersist)、scene-serialize(triggerAutoSaveImpl) | 各写一套 `clearTimeout` + `setTimeout` |
| 7 | `hexToRgb` | main.ts(字符串版) + settings-shared.ts(对象版) | 双实现、默认值需对齐、core→menus 依赖倒置风险 |

### 根因

- 纯函数 helper 无统一归属，每个模块遇到需求就地手写；
- 颜色相关（`Color3` 构造、`hex` 解析）混在业务逻辑里，且 `hexToRgb` 越过分层（core 直接依赖 menus）。

---

## 决策

**纯函数 helper 统一收敛至 `core/utils.ts`；Babylon 依赖的颜色 helper 收敛至新建 `core/color-helpers.ts`**，按"零风险改用 → 低风险纯函数 → 中风险归一 → 高风险独立排期"逐级推进。

| Helper | 落点 | 说明 |
|--------|------|------|
| `clamp` / `clampInt` / `clamp01` / `lerp` / `lerpArray` | `utils.ts` | 统一签名；`clamp01` 替代 `clamp(v,0,1)` 语义 |
| `formatTimestamp(d = new Date())` | `utils.ts` | 默认参数支持 0 参"当前时间"与显式传参 |
| `debounce` / `deepClone` | `utils.ts` | 复用既有实现 |
| `col3FromTriple(t: readonly number[])` | `color-helpers.ts` | 替代 19 处 `new Color3(arr[0],arr[1],arr[2])`；`?? 0` 守卫兼容 `noUncheckedIndexedAccess` |
| `hexToRgb`(对象版) / `rgbToString` | `color-helpers.ts` | 从 main/settings-shared 下沉，唯一实现，默认值 `74,108,247` 不变 |

### 选项

| 选项 | 描述 | 结论 |
|------|------|------|
| A. 维持现状，各模块手写 | 每次需求变更要改 N 处，易漏改复发同类 bug | ❌ 否决 |
| B. 全部塞进 `utils.ts`（含颜色） | 污染 utils 纯工具性质，Babylon 依赖不应进 utils | ❌ 暂否 |
| C. 分层（`utils` 纯函数 + `color-helpers` 颜色） | 职责清晰、依赖方向正确 | ✅ 采用 |

---

## 约束

- `color-helpers.ts` 仅依赖 `@babylonjs/core`，不得反向依赖 menus/core 业务模块（解决 core→menus 倒置）。
- `settings-shared.ts` 通过 `export { hexToRgb, rgbToString } from '../core/color-helpers'` 保持对外 API 稳定，外部调用方无需改动。
- `formatTimestamp` 改默认参数属向后兼容（既有调用均为 0 参），不改变输出格式 `HH:mm:ss.SSS`。
- 手写防抖改造采用"函数声明薄委托 + debounce 实例"模式，保留 `scheduleCameraPersist` / `triggerAutoSaveImpl` 的 `export function` 语义与 hoisting，便于 observable 注册引用。

---

## 执行情况（2026-07-13）

### clamp / lerp 系列（纯函数提取）
- `utils.ts` 新增 `clamp` / `clampInt` / `clamp01` / `lerp` / `lerpArray`。
- `renderer.ts` 删除局部 `clamp` / `clampColorChannel` / `lerp`，改用 `clamp` / `clamp01` / `lerp` / `lerpArray`。
- `physics-bridge.ts`、`feet-adjustment-math.ts`、`skirt-analyzer.ts`、`camera.ts`(clampFov) 删除局部 clamp，复用 `clamp` / `clampInt` / `clamp01`。
- `env-bridge.ts` 局部 `const lerp` 改为委托 `lerpUtil`。

### col3FromTriple（19 处）
- `color-helpers.ts` 新建 `col3FromTriple`，签名放宽至 `readonly number[]` + `?? 0` 守卫（兼容 `noUncheckedIndexedAccess`）。
- env-impl(7)、env-water(4)、env-bridge(1)、lighting(6)、outfit(1) 共 19 处 `new Color3(x[0],x[1],x[2])` → `col3FromTriple(x)`。
- 字面量构造（如 `new Color3(0,0,0)`）与 `new Vector3(...)` 不改。

### formatTimestamp / debounce / deepClone
- `performance.ts` 删除本地 `logTime`，`env-bridge.ts` 删除 `_ts`，`main.ts` 删除 `_ts`；调用点统一 `formatTimestamp()`。
- `camera.ts` `scheduleCameraPersist` → `debounce` 薄委托；`scene-serialize.ts` `triggerAutoSaveImpl` → `debounce` 薄委托，`cleanupAndFlushSave` 改用 `._autoSaveDebounced.cancel()`。
- `scene-bundle.ts:102`、`camera.ts:1021/1043` 的 `JSON.parse(JSON.stringify)` → `deepClone`。

### hexToRgb 归一（中风险）
- `main.ts` 删除字符串版 `hexToRgb`，改用 `color-helpers` 对象版 + `rgbToString`，输出默认值 `'74, 108, 247'` 与 settings-shared 完全一致。
- `settings-shared.ts` 删除本地 `hexToRgb` / `rgbToString`，改为从 `color-helpers` 导入并 re-export。

### 零风险改用（本次 + 上轮）
- `getBaseName` 复用 7 处（`outfit` / `scene-bundle` / `props` / `model-loader` / `vmd-layers` / `vmd-loader` / `library-core`），替代 `p.split('/').pop()`。
- `outfit.ts` `_encodePath` 删除，复用 `normPath`（ADR-095）。

---

## 验证

- `npx tsc --noEmit`：0 错误（含此前记录的 library-core private 访问问题当前亦已无报错）。
- `npx vitest run`：46 文件 / 1342 用例全部通过。
- `npm run build` 构建通过（esbuild 容忍既有 tsc 告警，本次无新增）。
