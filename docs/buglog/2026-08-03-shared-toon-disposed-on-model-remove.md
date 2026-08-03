# 换装/替换模型后，新模型眼睛变纯黑且不受光照影响

> **状态**: 🟢 已修复

**日期**: 2026-08-03
**严重程度**: 🟠 P2
**影响范围**: `frontend/src/scene/manager/model-manager.ts`、`frontend/src/core/dispose-helpers.ts`
**发现方式**: 用户反馈
**修复提交**: `0ef219df`（该提交消息写的是 motion autosave，本修复被并发会话混入其中，blame 时请以本文为准）

---

## 问题描述

替换模型后，新模型的**眼睛渲染为纯黑**，且**不随场景光照变化**——调亮调暗环境光、移动灯光都无反应。其他部位（皮肤、衣服）贴图正常。重复换装时黑眼会交替出现/消失。

## 复现步骤

1. 加载模型 A
2. 加载模型 B 替换 A（触发 `ModelManager.remove(A)`）
3. 观察模型 B 的眼睛

**关键观察（定位根因的决定性线索）**：第 1 帧能看到 B 的眼睛是正常的，第 2 帧——也就是 A 被移除之后——才变黑。

## 根因分析

**凶手是被移除的旧模型，不是新加载的模型。**

1. babylon-mmd 的 MMD 共享 toon（toon01–10）是**全局单例**。纹理缓存键为
   `file:shared_toon_texture_<N>`（`mmdAsyncTextureLoader.js:369-374`），
   **不含区分模型的 `fileRootId`**——对比普通贴图的键带
   `fileRootId = "file:" + pmFileId + "_"`（`pmLoader.js:691`，`pmFileId` 来自
   `ObjectUniqueIdProvider.GetId(pmxBytes)`，每次加载单调递增）。
   所以模型 A 和 B 拿到的是**同一个 `Texture` 实例**。

2. `MmdPluginMaterial.dispose(forceDisposeTextures)` **无引用计数**，直接
   `this._toonTexture?.dispose()`（`mmdPluginMaterial.pure.js:238-242`）。

3. `ModelManager.remove()` 为防 GPU 纹理泄漏，对每个材质调用
   `mat.dispose(false, true)`（`disposeTextures=true`）。级联下去就把那个
   **仍被存活模型 B 引用的共享 toon 单例销毁了**。

**症状对照**：
| 现象 | 解释 |
|------|------|
| 第 1 帧正常、第 2 帧黑 | B 复用活着的 toon → A dispose 杀掉它 |
| 只有眼睛黑 | MMD 惯例上眼睛材质才用共享 toon，其他部位用自带贴图 |
| 不受光照影响 | toon 是 shading LUT（明暗查找表），被销毁后材质失去光照响应通道 |
| 交替出现 | `_handleTextureOnDispose` 会清缓存，下次加载重建，故隔次复现 |

## 修复方案

新增 `detachSharedTextures(disposing: Set<Material>)`（`core/dispose-helpers.ts`）：
批量 dispose 前扫描场景中**不在本次销毁集合内的存活材质**，
若某纹理仍被存活材质引用，就把它从待销毁材质的插槽
（`toonTexture`/`sphereTexture`/`diffuseTexture`/`emissiveTexture`）上摘掉，
让 `dispose` 够不着它。**独占纹理不动**，照常释放——不引入 GPU 泄漏回归。

`model-manager.ts` 的 `remove()` 拆成两步：先收集 `disposedMats` 集合 →
`detachSharedTextures(disposedMats)` → 再统一 `mat.dispose(false, true)`。

附 5 条回归测试（`core/__tests__/dispose-helpers.test.ts`）：共享纹理被摘除、
独占纹理保留待释放、整组销毁时不摘除、多插槽同时摘除、空集合安全。

## 排查弯路（重要）

前期误判为**加载侧**问题：怀疑 `browser-adapter.ts` 的 `readFileBytes` 扁平兜底键
`file:<stem>` 导致跨模型贴图字节串味。后来发现两点证伪：

1. `ListDirRecursive` 只枚举 `dir:` 键（`:2122`），贴图根本走不到那些兜底分支；
2. `ObjectUniqueIdProvider` 保证 `pmFileId` 单调递增，普通贴图 cacheKey 跨模型**不可能**相撞。

（顺带一提：`file:5_T_Michele_Face_S215_D.png` 里的 `5_` 是 babylon-mmd 的
`pmFileId` 序号，**不是文件名的一部分**，别被它骗了。）

兜底键的模型作用域化改造仍有价值（防跨 zip 同名冲突，ADR-182），已单独保留在
`browser-adapter.ts`（提交 `4829f04f`），但它**不是本 bug 的解药**。

## 教训

1. **"新对象坏了" 未必是新对象的锅**——先问"上一帧还好好的，这一帧谁动了手"，
   帧级线索（用户提供的"第 1 帧正常"）比任何静态分析都精准。
2. **第三方库的 `dispose` 默认不做引用计数**。凡是"全局共享单例资源"
   （共享 toon、默认环境贴图、公共 RT），批量 dispose 前都得先确认没人还在用。
   判据很简单：看它的**缓存键里有没有模型身份**——没有就是共享的。
3. 探针打在错误的通道上会持续给出"一切正常"的假信号（当时探的是 diffuse，
   真正死掉的是 toon）。探针没反应时，先怀疑探错了地方。
