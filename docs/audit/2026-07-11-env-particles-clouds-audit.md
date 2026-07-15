# 第②轮审核 — 粒子+云模块修复记录

**日期**: 2026-07-11
**发现方式**: 代码审核（第②轮）

---

## 修复 1: canvas.getContext('2d')! 非空断言（env-particles.ts）

**严重程度**: P3 — 阻塞测试添加

`canvas.getContext('2d')!` 的 `!` 断言在非浏览器环境（Node/Vitest）直接抛错，是粒子模块零测试覆盖的根本阻塞点。

**修复**: 替换为带守卫的写法，抛出有意义的错误信息。

## 修复 2: splash observer 每帧 Vector3 分配（env-particles.ts）

**严重程度**: P3 — GC 压力

`ps.emitter = new Vector3(rx, groundY + 0.1, rz)` 每帧创建新对象。对比 followObserver 中复用 `ps.emitter` 引用的模式，splash observer 额外产生 GC 压力。

**修复**: 添加模块级 `_splashPos` 复用 Vector3，使用 `.set()` 更新坐标。

## 修复 3: _volCloudObs 冗余变量（env-clouds.ts）

**严重程度**: P3 — 心智负担

`_volCloudObs` 与 `mesh.metadata.obs` 存储同一个 observer 引用。`disposeClouds` 对同一 observer 调用两次 remove（Babylon 虽容错，但增加理解成本）。

**修复**: 删除 `_volCloudObs` 模块变量，统一通过 `mesh.metadata.obs` 访问。

## 修复 4: as DirectionalLight 无类型守卫（env-clouds.ts）

**严重程度**: P4 — 类型安全

`scene.getLightByName('dir') as DirectionalLight` 如果灯光类型被意外替换（如换成 PointLight），`dl.direction` 会运行时错误。

**修复**: 改用 `instanceof DirectionalLight` 类型守卫，利用已有的 else fallback 分支。
