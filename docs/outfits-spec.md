# 服装变体配置指南

## 概述

在模型所在目录放置 `outfits.json` 即可启用服装变体功能。无配置时自动扫描子目录。

## 方式一：自动发现（零配置）

将替换纹理放入模型目录下的一级子目录即可自动识别为变体。

```
模型目录/
├── model.pmx
├── face.png               ← PMX 原始纹理
├── costume_diff.png
├── costume_toon.png
├── swim/                   ← 自动识别为 "swim" 变体
│   ├── face.png            ← 同名文件替换 diffuse
│   └── costume_diff.png    ← 同名文件替换对应槽位
└── casual/                 ← 自动识别为 "casual" 变体
    ├── face.png
    └── costume_toon.png
```

**匹配规则**：
- 子目录名 → 变体名
- 子目录内的文件与 PMX 原始纹理的 basename 匹配即替换
- 仅替换有匹配的槽位，未匹配的保持原始贴图
- 递归深度：仅一级子目录

## 方式二：显式配置（outfits.json）

### 基本结构

```json
{
  "version": 1,
  "variants": [
    {
      "name": "我的变体",
      "all": {
        "diffuse": "alternative_diff.png",
        "toon": "alternative_toon.png"
      }
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | number | 是 | 固定为 1 |
| `variants` | array | 是 | 变体列表，至少一项 |
| `variants[].name` | string | 是 | 显示名称，在 UI 中展示 |
| `variants[].all` | object | 否 | 应用到所有材质 |
| `variants[].byCategory` | object | 否 | 按部位分类应用 |
| `variants[].byMaterial` | object | 否 | 按材质名精确应用 |

### 纹理槽位

每个变体配置（`all` / `byCategory` / `byMaterial` 内的值）支持以下槽位：

| 槽位键 | 对应贴图类型 | MMD 术语 |
|--------|-------------|----------|
| `diffuse` | 漫反射贴图（主贴图） | toon color |
| `toon` | 卡通渲染贴图 | toon texture |
| `spa` | 球面反射贴图 | sphere map |
| `normal` | 法线贴图 | bump |
| `emissive` | 自发光贴图 | emissive |

所有槽位均为可选，未指定的保持原始贴图。

### 按部位应用（byCategory）

```json
{
  "version": 1,
  "variants": [
    {
      "name": "泳装",
      "byCategory": {
        "服装": { "diffuse": "swim_costume.png", "toon": "swim_costume_toon.png" },
        "皮肤": { "diffuse": "swim_skin.png" }
      }
    }
  ]
}
```

支持的四类部位：
- `皮肤` — skin/face/body 等材质
- `头发` — hair/髪/ahoge 等材质
- `眼睛` — eye/目/iris/瞳/pupil 等材质
- `服装` — 以上均不匹配的材质

### 按材质名精确应用（byMaterial）

```json
{
  "version": 1,
  "variants": [
    {
      "name": "丝袜颜色",
      "byMaterial": {
        "socks": { "diffuse": "black_socks.png" },
        "ribbon": { "diffuse": "red_ribbon.png", "toon": "red_ribbon_toon.png" }
      }
    }
  ]
}
```

材质名来自 PMX 文件内部定义的材质名称，不区分大小写。

### 三层混合示例

```json
{
  "version": 1,
  "variants": [
    {
      "name": "完整示例",
      "byMaterial": {
        "socks": { "diffuse": "black.png" }
      },
      "byCategory": {
        "服装": { "diffuse": "costume.png" }
      },
      "all": {
        "toon": "night_toon.png"
      }
    }
  ]
}
```

优先级：**byMaterial > byCategory > all**
最终每材质每槽位的值 = `byMaterial[name]` ?? `byCategory[cat]` ?? `all` ?? 原始贴图。

## 贴图路径

`outfits.json` 中写的路径是**相对 PMX 文件所在目录**的路径。

```
模型目录/
├── model.pmx
├── default_diff.png
├── swim/
│   └── alt_diff.png
└── outfits.json
```

变体配置写法：
```json
{
  "all": { "diffuse": "swim/alt_diff.png" }
}
```

## 支持的图片格式

与 MikuMikuAR 整体支持的格式一致：PNG、BMP（DXT）、TGA、JPEG、DDS、KTX、EXR、HDR。
