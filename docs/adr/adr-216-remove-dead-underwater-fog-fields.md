# ADR-216: 移除死状态字段 underwaterFogDensity / underwaterFogMultiplier

- **状态**: ✅ 已实施
- **日期**: 2026-07-30
- **相关**: ADR-137（EnvState 单一源 Schema）、ADR-210（变量名名实相符）、ADR-212（命名审计）、ADR-211（水面功能开关体系）
- **源码锚点**: `frontend/src/core/env-state-schema.ts`（Underwater 分组）、`frontend/src/core/state.ts`（defaultEnv 派生）、`frontend/src/scene/env/env-lighting.ts`（`env:water` 事件重绘清单）、`frontend/src/menus/env-water-levels.ts`（`env:water:under-fog-density` 滑块）、`frontend/src/scene/env/env-water.ts`（水下渲染实际消费点）

---

## 一、问题陈述

水下雾气效果曾用 Babylon `scene.fog`（`FOGMODE_EXP2` 指数雾）实现，由 `underwaterFogDensity` / `underwaterFogMultiplier` 两字段驱动。

指数雾在本项目水面场景中有两个致命副作用：

1. **糊掉水面本身** —— 指数雾按相机距离对整个场景无差别混色，不认识"水面"概念。水面是 Gerstner 波 + 反射/折射 RT 的近景高频细节，被雾一视同仁地抹灰后，波纹与反射被雾化成一坨。
2. **双重压暗** —— 水下已做灯光衰减（`dir`/`hemi` intensity 随过渡值递减）。指数雾密度叠加后画面变成"黑水沟"，而非"清澈海水"。

因此实现改为**后处理管线方案**（见 `env-water.ts`）：
- `imageProcessing.colorCurves` 蓝绿色相旋转（`globalHue = 200`，保亮度，非加灰）
- `chromaticAberration` 色差
- 灯光衰减

替换后，`underwaterFogDensity` / `underwaterFogMultiplier` 成为**死状态字段**。

## 二、证据链（grep 验尸）

追踪 `envState.underwater*` 的全部运行时读取点（`env-water.ts`），水下渲染实际只消费三个字段：

| 字段 | 消费点 | 作用 |
|------|--------|------|
| `underwaterEnabled` | `env-water.ts:1137` | 是否进入水下态 |
| `underwaterChromaticAmount` | `env-water.ts:1173` | 色差强度 |
| `underwaterToneIntensity` | `env-water.ts:1185` | colorCurves 密度（蓝绿色调） |

`underwaterFogDensity` / `underwaterFogMultiplier` 全部命中均为**非渲染引用**：

| 命中类型 | 位置 | 性质 |
|---------|------|------|
| Schema 定义 | `env-state-schema.ts` | 字段声明 |
| State 初始化 | `state.ts` | 从 schema 灌默认值 |
| 事件重绘清单 | `env-lighting.ts` `env:water` 组 | 只触发刷新，刷新逻辑不读 |
| 菜单滑块 | `env-water-levels.ts` `env:water:under-fog-density` | **拉了没反应的幽灵开关** |
| 测试 | env-state / binding-factories / feature-levels | 仅校验字段存在性，非行为断言 |

**判决**：`under-fog-density` 滑块（label 用 `env.fogDensity`）绑定到 `underwaterFogDensity`，值写进 state 后无任何渲染路径消费，属"名不副实幽灵开关"（违反"UI 控件文案名实相符"规范）。`underwaterFogMultiplier` 连滑块都没有，纯死字段。

## 三、决策

彻底清理该死链路：

1. 删除菜单幽灵滑块 `env:water:under-fog-density`
2. 从 schema 移除 `underwaterFogDensity` / `underwaterFogMultiplier`
3. 从 `env-lighting.ts` 的 `env:water` 事件重绘清单移除这两字段
4. 同步测试断言（env-state.test 字段清单与 defaultEnv、binding-factories mock、feature-levels contract）

## 四、兼容性分析

`setEnvState` 用 `Object.assign(envState, migrated)`（`env-bridge.ts:323`），**不做 schema 白名单校验**。旧存档中残留的 `underwaterFogDensity` 键在加载时被 `Object.assign` 当作无害多余属性写入 envState：不报错、无渲染消费、随普通对象一起序列化。

因此这是**删除类**清理，无需注册 migrator（对比 ADR-210/212 的改名迁移需 migrator，删除类不需要）。删 schema 字段不会炸旧存档。

## 五、保留项说明

- `env.fogDensity` i18n key **保留** —— 仍被 `env-fog-levels.ts` 的全局大气雾滑块复用（不同功能，正确复用）。
- `underwaterChromaticAmount` / `underwaterToneIntensity` / `underwaterTintStrength` **保留** —— 前两者是有效渲染消费点；`underwaterTintStrength` 属独立字段，不在本次范围。

## 六、验证

- `npx tsc --noEmit`：零错误（EnvState 类型从 schema 派生，字段删除后引用点已同步）
- `vitest run env-state / env-feature-levels.contract / scene/env-water`：73/73 通过
- `vitest run bindings/app.contract`：17/17 通过
- grep 复查：除本 ADR 注释外，`underwaterFogDensity` / `underwaterFogMultiplier` 零残留
