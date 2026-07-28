# ADR-202: fork 自治改动批次 — 一次回灌批量根治可改 fork 的上游缺口

> **状态**: 🟡 草案（承重项 P0「fork 产物 CI 可复现分发」未解决前，任何 fork 改动不得进发版）
> **关联**: ADR-201（原生刚体施力导出，本批次 P1 受益项）、ADR-200（路径1 已采纳）、ADR-192（永久自治下游）、`docs/upstream/babylon-mmd-compatibility.md`（23 处应对台账，本 ADR 在「自治路径解锁」新前提下重评）
> **背景**: ADR-192 时代「fork 改动只能走 PR、PR 被上游拒」→ 全部本地应对。ADR-201 证明 **fork 本地可编译回灌**，分类前提翻转：对**运行时功能类**缺口，「改 fork」首次成为比「JS 反射/绕路」更根治的选项。本 ADR 把值得改 fork 的收敛为一个批次，避免零散决策。

---

## 一、P0 承重项 — fork 产物如何进入 CI（未解决则全批次阻塞）

> **这是本 ADR 的头号阻塞项，必须先解决，否则下面所有改动在发版产物里不存在。**

### 1.1 现状：CI 拿的是官方版，fork 改动会「蒸发」

| 环节 | 事实 | 后果 |
|------|------|------|
| [frontend/package.json:72](../../frontend/package.json) | `"babylon-mmd": "^1.2.0"` | 声明 registry 版本 |
| [package-lock.json:2534-2537](../../frontend/package-lock.json) | resolved = `registry.npmmirror.com` 官方 1.2.0 tarball + integrity 哈希 | 锁死官方版 |
| CI 全线（`release.yml` / `ci.yml` / `web-pages.yml` / `webgl-weekly.yml` / `cache-warm.yml`） | 全部 `npm ci` | 严格按 lockfile 拉官方 1.2.0，integrity 校验**拒绝**本地篡改 |

**结论**：本地 `node_modules/babylon-mmd` 是手动覆盖的 fork 产物（能跑）；CI 干净机器 `npm ci` 只拿官方版 → fork 新导出在发版产物里**不存在** → 运行时 `undefined is not a function`。

### 1.2 分发方案对比

| 方案 | CI 可复现 | 代价 | 采纳 |
|------|----------|------|------|
| `file:` 本地路径 | ❌ CI 无 `C:\Users\...\babylon-mmd`，发版直接挂 | — | ❌ |
| **git 依赖**（`github:eghrhegpe/babylon-mmd#<tag>`，dist 提交进 fork） | ✅ `npm ci` 可复现拉取 | fork 需 commit 编译产物、打 tag | ✅ **推荐** |
| vendored 进 app 仓库（`frontend/vendor/babylon-mmd` + `file:./vendor/...`） | ✅ | app 仓库体积涨、wasm 二进制入 git | 🟡 折中 |

### 1.3 推荐：git 依赖（方案 2）

1. fork 里编译 `dist/`（`build-esm`）+ `wasm/mpr`（`build-wasm-mpr`），**commit 编译产物**，打 tag（如 `v1.2.0-mmar1`）。
2. app `package.json` 改 `"babylon-mmd": "github:eghrhegpe/babylon-mmd#v1.2.0-mmar1"`，`npm i` 重新生成 lockfile（resolved 指向 git tarball + commit-ish）。
3. CI `npm ci` 按新 lockfile 从 GitHub 拉 fork tag → 产物含新导出，可复现。
4. 此路径同时解决「原仓库拒 AI PR」——不发 PR，吃自己 fork 的 tag。

> **注**：git 依赖需 fork 仓库把编译产物 commit 进版本（默认 `.gitignore` 排除 `dist/`/`wasm/`，需为分发 tag 例外）。或建独立 `-dist` 分支只放产物。

---

## 二、批次清单 — 23 处应对在「自治路径解锁」新前提下重评

> 前提翻转：ADR-192 的「全部本地应对」建立在「只能提 PR」上。现可本地回灌，重新分类为「改 fork 是否比现状更划算」。

### A 类 — 纯类型/测试缺口（改 fork 零收益，维持现状）

条目 1/2/4/5/6/8/10/11/16/19/20/23（`compatibility.md` 编号）：运行时对象本就有成员，仅 `.d.ts` 未声明；或 Babylon.js 侧类型 / 测试 mock。上游「接口最小化」是设计立场，本地交集类型是官方推荐消费方模式。**共 13 条，不动。**

### B 类 — 运行时能力缺口（改 fork 可根治）

| 条目 | 缺口 | 编译路径 | 划算度 | 批次优先级 |
|------|------|---------|--------|-----------|
| **3（含 ADR-201）** | 原生刚体无 JS 句柄 / `_rigidBodyBundleMap` 反射 | `build-wasm-mpr` + `build-esm` | ✅ 最划算 | **P1** |
| **7** | `physics` / `impl` 反射访问 | TS `build-esm` | ✅ 提公开 getter，连带清 3 的反射 | **P1（搭车）** |
| **9** | `StreamAudioPlayer._audio` 私有反射 | TS `build-esm`（纯 JS 类，非 wasm） | ⚠️ 加 `get audio()` 即可 | **P2（搭车）** |
| **14** | `setRuntimeAnimation` 不重置时钟 | TS `build-esm` | 🟡 reset 时钟根治，但本地 `seekAnimation(0)` 已稳 | **P3（可选）** |
| **17** | 无 `onFinish`，用 `onPause` 代替 | TS `build-esm` | 🟡 加 `onFinishObservable`，但 `onPause` 兜底已稳 | **P3（可选）** |
| **13** | WASM 模式 `ikSolver = null`，自建 2-bone IK | — | ❌ 逆上游设计（§153-155 数据竞争），本地方案已完全独立稳定 | **不碰** |
| **15** | `VmdLoader` 无 `dispose()` | — | 🟢 无状态需释放，非缺陷 | **忽略** |

### C 类 — 构建/副作用/知识（与源码改动无关）

条目 12/18/21/22：时序文档、移除 monkey-patch、side-effect 导入、MPR 动态导入。**改 fork 无意义。**

---

## 三、批次执行计划

| 阶段 | 内容 | 编译路径 | 依赖 |
|------|------|---------|------|
| **P0** | 定分发方案（git 依赖）→ fork commit 产物 + 打 tag → app 改 `package.json` + 重生 lockfile → **CI `npm ci` 验证拉到 fork 版** | — | 无（最先做） |
| **P1** | 原生刚体施力导出（ADR-201，`mmdModelRigidBodyApplyCentralForce` 等，**注：fork 源码里私有字段访问需改用 `physics_model_context()` 访问器，否则 E0616 编译失败**）+ `physics.impl`/`_rigidBodyBundleMap` 提公开 getter | `build-wasm-mpr` + `build-esm` | P0 |
| **P2** | `StreamAudioPlayer` 加 `get audio()` | `build-esm` | P0 |
| **P3（可选）** | `setRuntimeAnimation` reset 时钟 / `onFinishObservable` | `build-esm` | P0 |

> **关键顺序**：P0 是所有 fork 改动能进发版的**共同前提**。建议 P0 单独先跑通（哪怕先只带 P1 一项），验证「改 fork → 编译 → tag → CI 可复现」整条链，再一次性把 P2/P3 搭上，避免为未验证的链路提前铺摊子。

---

## 四、对 CI / 发版的影响（本 ADR 核心结论）

- **P0 未解决前**：任何 fork 改动**不得**合入 app 发版路径——CI 拿官方版，改动蒸发，调用即崩。
- **P0 解决后**：CI 影响可控——`npm ci` 拉 fork tag（git 依赖），无本地机器依赖；lockfile 锁定 commit-ish，可复现；升级 fork = 换 tag + 重生 lockfile，与普通依赖升级同构。
- **软风险**：git 依赖下 `npm ci` 需能访问 GitHub（CI 已联网，无碍）；fork tag 一旦被引用不可移动（同 npm 版本不可变约定）。

---

## 五、待办

1. **P0 拍板**：确认走 git 依赖（方案 2）还是 vendored（方案 3）。
2. fork 分发 tag 的产物提交策略（`.gitignore` 例外 or 独立 `-dist` 分支）。
3. P0 链路验证：改 `package.json` → 重生 lockfile → 本地 `npm ci` 模拟 CI 拉取 → 确认 `node_modules/babylon-mmd` 含新导出。
4. 验证通过后按 P1 → P2 实现（fork 改动需终端跨目录操作，工作区外沙箱限制，见 ADR-201）。
