# ADR-089: 地面模式分类重构 —— 拆分为几何类型(groundType) + 外观样式(groundStyle)

> **状态**: 已完成

## 1. 背景

地面系统历经 ADR-052（纯色/网格/棋盘格/纹理 4 种模式增强）、ADR-083（追加 `heightmap` 第 5 种模式，程序化 FBM 地形）多轮迭代。但 `groundMode` 单一枚举同时承载了**两条正交轴**：

- **几何类型轴**：`heightmap` = 程序化 3D 地形（真实位移 + 碰撞）；其余 4 种 = 同一张 `CreateGround` 平面，仅表面长相不同。
- **外观样式轴**：`solid` / `grid` / `checker` / `texture` = 平面的 4 种外观。

用户在实操中明确指出该分类「奇怪」：纹理模式独占一整棵子设置树（预设/自定义/缩放/旋转），而 `heightmap` 作为第 5 个平级选项排在末尾，地形参数像事后补丁。根因为 ADR-052 第 126 行将 `heightmap`「追加」进同一枚举，与 4 种外观样式混为 5 个平级选项，概念上不成立——地形不是「平面的一种样式」，而是另一类地面。

## 2. 决策

将 `groundMode` 拆为两个独立字段：

```typescript
groundType: 'flat' | 'terrain';   // 几何类型：平面 / 程序化地形（原 heightmap）
groundStyle: 'solid' | 'grid' | 'checker' | 'texture'; // 仅 flat 时有效（外观样式）
```

- `groundType === 'terrain'` 对应原 `heightmap`。
- `groundType === 'flat'` + `groundStyle` 对应原 `solid/grid/checker/texture`。

UI 层面同步重组：地面面板引入顶层「地面类型」(平面/地形) 分段选择，其下「地面样式」(纯色/网格/棋盘格/纹理) 仅在平面时显示；地形参数归入独立的 `terrain` 分支。纹理子设置不再与地形平级堆叠。

## 3. 方案细节

### 3.1 类型与默认值

- `core/types.ts`：`EnvState.groundMode` → `groundType` + `groundStyle`。
- `core/state.ts`：默认 `groundType: 'flat', groundStyle: 'solid'`。

### 3.2 配置迁移（关键）

旧配置以 `groundMode` 持久化。为避免破坏历史存档，在**唯一中央入口** `setEnvState`（`scene/env/env-bridge.ts`）顶部注入 `migrateEnvState()`：

- 若入参含 `groundMode` 且尚无 `groundType` → 映射：`heightmap` → `groundType:'terrain'`；其余 → `groundType:'flat'` + `groundStyle:<原值>`；随后删除 `groundMode`。
- 补齐默认：`groundType` 缺省为 `'flat'`，`flat` 下 `groundStyle` 缺省为 `'solid'`。

集中迁移覆盖所有 hydrate 路径（`core/main.ts`、`scene/scene-serialize.ts`、预设应用等），对 UI `onChange` 调用（传入新字段）无副作用。

`groundKeys` 数组同步将 `'groundMode'` 替换为 `'groundType', 'groundStyle'`。

### 3.3 渲染层（`env-impl.ts` `applyGround` / `getGroundHeightAt`）

- 原 `groundMode === 'heightmap'` 分支 → `groundType === 'terrain'`（地形创建、坡度禁用、贴地查询）。
- 原 `groundMode === 'grid' | 'checker' | 'texture'` 分支 → `groundStyle`（材质选择、纹理滚动、跟随相机）。
- typeKey 生成中 `mode:${groundMode}` → `mode:${groundStyle}`。

### 3.4 UI 层（`env-feature-levels.ts` `buildGroundLevel`）

- 「地面模式」单选择器 → 「地面类型」(`flat`/`terrain`) + 「地面样式」(`solid`/`grid`/`checker`/`texture`)，后者包在 `if (s.groundType === 'flat')` 内。
- 颜色/不透明度/网格/棋盘格/纹理子设置归入 flat 分支；地形高度/缩放/种子/八度归入 `if (s.groundType === 'terrain')` 分支。
- 增强折叠区内坡度（pitch/roll）仅在 flat 显示；高程着色仅 terrain；跟随相机仅 grid 样式——全部改用 `groundType`/`groundStyle`。

### 3.5 预设与音效

- `env-preset-levels.ts`：`SCENE_PRESETS` 中 9 处 `groundMode` 映射为 `groundType:'flat'` + 对应 `groundStyle`。
- `footstep.ts`：`resolveGroundSfxKind` 按 `groundType==='terrain' → 'concrete'`，`groundStyle==='texture'` 按纹理名选 `grass/wood`。

### 3.6 契约层（Go + 生成绑定）

- `internal/app/app.go`：`EnvState.GroundMode string json:"groundMode"` → `GroundType string json:"groundType"` + `GroundStyle string json:"groundStyle"`。
- `frontend/bindings/mikumikuar/internal/app/models.ts`：同步镜像（等价于 `wails generate` 产物）。

### 3.7 i18n

5 语言（`zh-CN`/`zh-TW`/`ja`/`ko`/`en`）：`env.groundMode` → `env.groundType`，新增 `env.flat` / `env.terrain` / `env.groundStyle`。

## 4. 涉及文件

| 文件 | 操作 |
|------|------|
| `core/types.ts` | 修改：`groundMode` → `groundType` + `groundStyle` |
| `core/state.ts` | 修改：默认值 |
| `scene/env/env-bridge.ts` | 修改：新增 `migrateEnvState` + `setEnvState` 调用；`groundKeys` 更新 |
| `scene/env/env-impl.ts` | 修改：10 处 `groundMode` 分支改 `groundType`/`groundStyle` |
| `menus/env-feature-levels.ts` | 修改：`buildGroundLevel` 重组为类型/样式两级 |
| `menus/env-preset-levels.ts` | 修改：9 处预设映射 |
| `scene/motion/footstep.ts` | 修改：脚步音色按 `groundType`/`groundStyle` |
| `core/i18n/locales/*.ts` (5) | 修改：标签 |
| `internal/app/app.go` | 修改：Go 契约结构体 |
| `frontend/bindings/mikumikuar/internal/app/models.ts` | 修改：生成绑定镜像 |
| `__tests__/env-state.test.ts` | 修改：默认对象 + 字段清单 |
| `__tests__/env-bridge.test.ts` | 修改：3 处 |
| `__tests__/mocks/binding-factories.ts` | 修改：mock 镜像 |
| `__tests__/bindings/app.contract.test.ts` | 修改：EnvState 形态断言 |

## 5. 关联

- ADR-052（地面模式增强，heightmap 追加点）
- ADR-083（地面功能扩展，heightmap 落地）
- ADR-085（脚底贴合，依赖 `getGroundHeightAt`）
