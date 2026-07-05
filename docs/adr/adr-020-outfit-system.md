# ADR-020: 换装系统（服装变体/纹理替换）

**日期**：2026-06-28
> **状态**: 已完成

---

## 背景

PMX 模型通常包含多套服装纹理变体（如不同颜色的服装贴图），用户需要在运行时切换。DanceXR 有「Outfit」功能，通过替换贴图实现服装变体。

评估方案：
1. **模型级替换**：加载多个完整 PMX 模型切换
2. **纹理级替换**：单模型内替换贴图引用

## 决策

**选择方案 2：纹理级替换，基于 outfits.json 配置。**

### 核心设计

```
模型目录/
├── model.pmx
├── outfits.json          ← 服装配置（可选，自动发现也可）
├── tex/
│   ├── outfit_a/
│   │   ├── tex1.png     ← 替换贴图
│   │   └── tex2.png
│   └── outfit_b/
│       └── ...
```

### 技术路径

1. `outfit.ts` — 换装核心模块：
   - `loadOutfits(modelPath)` — 自动发现 `outfits.json` 或扫描 `tex/` 子目录
   - `applyOutfitVariant(variantName)` — 替换当前模型的贴图引用
   - `resetOutfit()` — 恢复原始贴图
2. `outfit-ui.ts` — 换装子菜单（MenuStack 集成）
3. 贴图替换机制：遍历 `mmdModel.materials`，找到对应 `diffuseTexture`/`sphereTexture`/`toonTexture`，调用 `Texture.dispose()` 旧贴图 + 创建新 `Texture(url)`

### 自动发现策略

- 优先读 `outfits.json`（显式配置）
- 无配置时扫描 `tex/` 子目录，每个子目录视为一个服装变体，目录名即变体名
- 贴图按文件名匹配原始贴图 basename

## 后果

- ✅ 运行时即时切换，无需重新加载模型
- ✅ 自动发现降低配置门槛
- ⚠️ 仅支持纹理替换，不支持网格/骨骼变更
- ⚠️ 贴图文件名匹配依赖 basename，大小写敏感环境需注意
- ✅ 场景序列化支持（`SceneFile` 含 `outfitVariant` 字段）

## 状态

✅ 已实现并验证（Phase 8），测试套件 `outfit.test.ts` 覆盖加载/应用/重置/序列化。