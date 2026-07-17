# ADR-120: 环境预设分类化 — 天空/地面/水面/大气

> **状态**: ✅ Phase 1 完成（Go API + bindings + TS 分类预设 + UI 重写 + i18n + 单测全绿；待真机验证）
> **日期**: 2026-07-16

## 背景与问题

当前用户环境预设（`.env` 文件）只保存 5 个字段：`label / skyColorTop / skyColorBot / sunAngle / azimuth`（见 `env-preset-levels.ts:29 snapshotCurrentEnvPreset`）。

而 `EnvState`（`types.ts:377-522`）有 ~90 个字段，覆盖天空/地面/水面/粒子/雾/云/风/布料等。用户精心调整完整环境后点「保存当前为预设」，加载时只剩天空色——地面纹理、水面反射、粒子类型、雾效、体积云全部丢失。

**三套保存机制覆盖对比**：

| 机制 | 字段数 | 入口 |
|------|--------|------|
| config.json.Env 自动持久化 | ~90 | `setEnvState` |
| 场景文件 scene.json | ~90 | `scene-serialize.ts` |
| 用户环境预设 .env | 5 | `snapshotCurrentEnvPreset` |

落差「夸张」：预设系统名义上叫「环境预设」，实际只存「天空+光照预设」。

### 连带问题

ADR-111 Phase 1 用 `_snapshotGroundWaterFields` 快照-恢复来防止预设覆盖地面/水面——这是在错误抽象层打补丁。根因是预设不保存完整环境，才需要快照模拟「不覆盖」。

## 决策：按语义分类保存（4 类）

将 EnvState 按视觉语义分 4 类，每类独立保存/加载。用户可单独保存某类预设，互不干扰。

### 字段分类

| 类别 | category 值 | 字段范围 | 字段数 |
|------|------------|---------|--------|
| 天空+光照 | `sky` | sky*/stars*/envIntensity/sunAngle/azimuth/lightingPresetName/timeOfDay* | 16 |
| 地面 | `ground` | 所有 ground* 前缀 | 38 |
| 水面+水下 | `water` | water*/planarReflect*/reflectionQuality/foam*/fresnel*/diffuseStrength/ambientStrength/ripple*/caustic*/underwater* | 32 |
| 大气 | `atmosphere` | wind*/particle*/clouds*/debugClouds/cloud*/fog*/debugMirrorEnabled | 22 |

排除字段（不参与任何预设）：`collisionEnabled / bodyCollisionEnabled / groundCollisionEnabled`（物理碰撞，非环境视觉）。

### 数据格式（version 3）

```json
{
  "version": 3,
  "category": "ground",
  "label": "草地纹理",
  "fields": {
    "groundType": "flat",
    "groundStyle": "texture",
    "groundTexture": "...",
    "groundColor": [0.3, 0.5, 0.2]
  }
}
```

- `fields` 只含该类别字段子集（`Partial<EnvState>`）
- 加载时 `setEnvState(preset.fields)` 只更新这些字段，其他类别不动

### 向后兼容（version 2 → sky）

旧 `.env` 文件（version 2）无 `category`/`fields`，顶层有 `skyColorTop/Bot/sunAngle/azimuth`。`importEnvPreset` 检测 version：
- v2 → 当作 `category: 'sky'`，把顶层 4 字段转入 `fields`
- v3 → 直接用 `fields`

`ListEnvPresets` 读 JSON 头部时同时取 `category`（无则默认 `'sky'`）。

### Go API 变更（最小）

`EnvPresetEntry` 加 `Category` 字段：

```go
type EnvPresetEntry struct {
    Name      string `json:"name"`
    Label     string `json:"label"`
    Category  string `json:"category"` // 新增：sky/ground/water/atmosphere
    CreatedAt int64  `json:"createdAt"`
}
```

`ListEnvPresets` 头部解析扩展（已有读 label 的逻辑，加读 category）。`SaveEnvPreset/SaveEnvPresetAuto` 签名不变（category 在 JSON 内容里）。

### TS 端变更

| 文件 | 改动 |
|------|------|
| `env-lighting.ts` | 新增 `EnvPresetCategory` 类型 + `ENV_PRESET_FIELDS` 白名单 + `snapshotEnvPresetByCategory` / `exportEnvPreset` / `importEnvPreset` 重写（支持 v2/v3） |
| `env-bridge.ts` | 新增 `applyEnvPresetByCategory`（按类别 setEnvState，无动画过渡） |
| `env-preset-levels.ts` | UI 重写：4 个分类区域，每区有保存按钮+预设列表；保留 SCENE_PRESETS 作为跨类别「场景氛围」快速预设 |

### UI 结构

```
环境预设弹窗
├── 场景氛围（内置快速预设，跨类别）
│   └── [舞台-A] [户外晴天] [演唱会] [摄影棚] [黄昏柔光] [雨天] [樱花季] [赛博都市]
├── 天空预设（category: sky）
│   ├── ＋ 保存当前天空为预设
│   └── 用户预设列表
├── 地面预设（category: ground）
│   ├── ＋ 保存当前地面为预设
│   └── 用户预设列表
├── 水面预设（category: water）
│   ├── ＋ 保存当前水面为预设
│   └── 用户预设列表
└── 大气预设（category: atmosphere）
    ├── ＋ 保存当前大气为预设
    └── 用户预设列表
```

### 与 ADR-111 的关系

分类预设落地后，`env-preset-levels.ts` 的 `_snapshotGroundWaterFields` 快照补丁**可删除**——sky 类预设只 apply sky 字段，天然不碰 ground/water，无需快照模拟。

## 实施步骤

1. Go: `env_preset.go` 扩展 `EnvPresetEntry.Category` + `ListEnvPresets` 头部解析
2. `npm run generate:bindings` 同步
3. TS: `env-lighting.ts` 新增分类类型 + v3 序列化 + v2 兼容
4. TS: `env-bridge.ts` 新增 `applyEnvPresetByCategory`
5. TS: `env-preset-levels.ts` UI 重写（4 分类 + 删除快照补丁）
6. i18n: 5 语言新增 `env-preset.category.sky/ground/water/atmosphere` 等 key
7. 测试: `env-lighting.test.ts` 加分类预设 + v2 兼容测试
8. 验证: `go build` + `tsc --noEmit` + `vitest`

## 未解决问题

- SCENE_PRESETS 内置预设是否也按分类拆分？当前决策：保留为跨类别「场景氛围」快速预设，不拆。
- 分类预设是否需要导入/导出（文件级分享）？延后，当前只做应用内保存/加载。
