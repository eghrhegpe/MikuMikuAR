# DanceXR 目录结构约定与共用策略

> 从 research-notes.txt 提取整理。DanceXR (dvvr) 的目录结构及与 MMDHub 的共享策略。

## DanceXR 是什么

DanceXR（dvvr, [alloystorm/dvvr](https://github.com/alloystorm/dvvr)）是一个跨平台 PMX/XPS/FBX 成品 viewer + motion player。

- 四个版本：Free / Pure / Pro / Creator
- 三种 build：RT / HD / LW
- 覆盖平台：PC / Mac / Android / Quest
- 底层：Unity C# 自写 PMX runtime（不是挂 assimp 或 mmdlib）

## DanceXR 内容库目录结构

```
<DanceXR根>/
├─ actors/      ← PMX / XPS / FBX（可 zip 包）
├─ motion/      ← VMD / BVH 动作
├─ stage/       ← 舞台/场景
├─ dressing/    ← 衣物/配饰
├─ presets/     ← 预设配置
├─ bundles/     ← 合集包
├─ effects/     ← 特效
├─ scenes/      ← 场景编排
├─ settings/    ← DanceXR 自己存的用户设置（别动）
```

### 路径差异

- **Windows**：默认在 `文档/DanceXR/` 或用户自选
- **Android 2024.3 之后**：`/DanceXR/`（存储根）
- **Android 旧版**：`/Android/data/com.vrstormlab.dancexr/files/`

## zip 兼容性

DanceXR actors/ **原生认 zip 包**——PMX/XPS/FBX 三种都能打包成 zip 放 actors/，文档建议"一个模型所有文件放一个 zip 包以获得更小文件大小"。

## 共用策略

**核心原则：** MMDHub 的库 ≠ DanceXR 的库，但 MMDHub 可以挂 DanceXR 的 actors/ 做联合扫描。

### 目录规范

```
<MMDHub根>/
├─ models/                    ← 自己的模型 zip
│  └─ model1/
│     ├─ model.zip            ← 原档（模之屋接管下来 / DanceXR 扫过来都这形态）
│     └─ meta.json            ← 元数据缓存
└─ external_scan_paths/       ← 外部路径引用
   └─ [symlink/配置指向 DanceXR actors/]
```

### 扫描逻辑

```
models/ 下的 .zip 直接扫
external_scan_paths 中扫描 actors/**/*.{pmx,zip}
发现 PMX 或 zip 内含 PMX → 读 header 摘 4 段 text → 入库
```

**只认 actors 下的 PMX/zip，DanceXR 的 settings/dressing/bundles 不碰。**

### 模之屋下载 → zip

从模之屋下载的 `.rar/.7z` 解压后重打成 `.zip`，给自己和 DanceXR 共用——库里只有 zip 一种容器。

### Android 注意事项

- Tauri 官方 fs 在 Android 读不了别家 app 的 `/DanceXR/actors`（scoped storage）
- 解法：`tauri-plugin-android-fs-api` 走 SAF URI 持久化，首次用户授权一次就静默扫

## DanceXR 与 MMDHub 定位区隔

| 维度 | babylon-mmd / three-mmd | DanceXR (dvvr) | MMDHub |
|------|-------------------------|-----------------|--------|
| 形态 | 库，你 import 进自己项目 | 成品 App，源码可参考 | 聚合管理器 + 播放器 |
| 你的角色 | 开发者，自己拼渲染/UI | 使用者，或基于它二开 | 聚合管理 |
| Web 能用？ | ✅ 浏览器直接跑 | ❌ 没有 Web 版 | 通过壳层 |
| 任意 motion × 任意 model | ❌ 得自己对齐骨骼 | ✅ 内置 A/T-pose 转换 + 骨修复 | 借用 DanceXR |
| 多 actor / 舞台 / 环境 | 自己做 | ✅ Pure 版起就支持 | 规划中 |
