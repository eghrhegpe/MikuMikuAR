# ADR-202: fork 自治改动批次 — 一次回灌批量根治可改 fork 的上游缺口

> **状态**: 🟢 P0 已落地（vendored + postinstall 方案，spr/mpr 生产变体经真机验证风力起效）；P2/P3 搭车项待续
> **P0 实现**: 采纳 vendored 方案（非初版推荐的 git 依赖）——fork 重编译的 spr/mpr wasm 产物提交进 `frontend/vendor/babylon-mmd-wasm/`，`postinstall`（`scripts/apply-vendored-wasm.mjs`）在 `npm ci` 后注入 `node_modules/babylon-mmd`。生产仅加载 spr/mpr（`InstanceType/*.js` 的 `../wasm/{spr,mpr}` import），mpd 为 debug 变体不分发。真机实测：模型原生发丝/裙摆随风摆动。
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
| git 依赖（`github:eghrhegpe/babylon-mmd#<tag>`，dist 提交进 fork） | ✅ `npm ci` 可复现拉取 | fork 需 commit 编译产物、打 tag；切版会连带 1.2→1.3 API 跳变 | ❌ 已探明不可行（见 §1.4） |
| **vendored 进 app 仓库**（`frontend/vendor/babylon-mmd-wasm/` + postinstall 注入） | ✅ | app 仓库体积涨、wasm 二进制入 git | ✅ **已采纳** |

### 1.3 已落地：vendored + postinstall（方案 3）

> 未选 git 依赖的原因：fork 是 1.3.0 源、app 装 1.2.0，切 git 依赖等于强制版本跳变（1.2→1.3），需先扫 API 破坏面；vendored 仅注入 wasm 产物，不动 JS 版本，风险更小。

1. fork 重编译 `build-wasm-spr` + `build-wasm-mpr`（生产变体）。
2. app 将 `spr/`+`mpr/` 产物拷进 `frontend/vendor/babylon-mmd-wasm/`（整目录，删 `.gitignore`），**commit 入 git**（`*.wasm` 已由 `.gitattributes` 标 binary）。
3. `postinstall`（`scripts/apply-vendored-wasm.mjs`）在 `npm i`/`npm ci` 后把 vendor 产物 `cpSync` 覆盖进 `node_modules/babylon-mmd/esm/Runtime/Optimized/wasm/{spr,mpr}`。
4. `npm ci` 先清空 node_modules 再装，postinstall 在装完后执行 → 注入不会被清掉，可复现。
5. 同时解决「原仓拒 AI PR」——不发 PR，fork 产物随 app 仓走。

### 1.4 修订：路线 A（git 依赖）实跑探明 — 包结构错位，不可行

> 2026-07-28 增补。fork 侧 build-esm 已修通（工具链三因修复），但 git 依赖方案因 fork 包结构天生为 npm publish 设计而落不了地。

**起因**：P0 vendored 落地后，为消除 vendor 目录维护负担，重启路线 A 评估。先扫 1.2→1.3 API 破坏面（结论：安全，CHANGELOG 仅附加 + bugfix，`mmd-adapter.ts` 的私有字段访问均带守卫降级），再修通 fork 的 `build-esm`，打 tag `v1.3.0-mmar1`，准备 app 侧切版本。

**build-esm 修通的三因修复**（fork commit `64a94ce`）：
1. `Cargo.toml` 加 `wasm-opt = false` — wasm-pack 从 GitHub releases 下载 binaryen 失败（CN 网络），在生成 `package.json` 前退出，导致 spr/mpr 缺 package.json → `typeof import("./wasm/spr")` 在 `moduleResolution: "bundler"` 下解析失败 → TS2312。
2. `tsconfig.lib.json` 关 `experimentalDecorators` + `emitDecoratorMetadata` — babylon.js 9.18 的 `@serialize` 已迁 TC39 标准装饰器签名，旧版冲突 → TS1240（`.pure.ts` 全挂）。
3. `.gitignore` 开例外让 `dist/esm/` + `wasm/` 入 git，忽略 wasm-pack 每次重建生成的子目录 `.gitignore`。

**为何仍不可行 — 三层结构性错位**：
1. **main 字段错位**：fork `package.json` 的 `main: "esm/index.js"` 指仓库根，`publish-lib` 发 `./dist`（产物提升为包根）→ registry 包有 `esm/`，git clone 没有（只有 `dist/esm/`）→ `import 'babylon-mmd'` 404。
2. **深路径 import 错位（致命）**：app **94 处**（38 个文件）`import "babylon-mmd/esm/Runtime/..."` 走深路径解析，不经过 `main`。git 依赖下 `node_modules/babylon-mmd/esm/Runtime/...` 不存在（产物在 `dist/esm/`），94 条全挂。`exports` map 重映射在 vite/webpack 下行为参差，不稳。
3. **postinstall 会崩**：fork `package.json` 的 `postinstall: "ts-node postInstallScript.ts && patch-package"` 依赖 devDeps，git 依赖不装 devDeps → `ts-node: command not found`。

**唯一干净解（`-dist` 分支）的代价**：建只放 dist 内容的分支，包根即 dist，`esm/` 和深路径都对。但每次 fork 重建产物需 force push `-dist`，双轨维护，代价高于 vendored（vendor 目录 ~200KB binary + 一个 postinstall 脚本）。

**结论**：路线 A 暂不采用。build-esm 修通 + tag `v1.3.0-mmar1` 保留在 fork 作为技术储备（证明 fork TS 可编译，为未来 upstream 修复后切 registry 1.3.0 扫清障碍）。P0 维持 vendored。

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
| **13** | WASM 模式 `ikSolver = null`，骨骼覆盖后无法重解 IK | `build-wasm-spr/mpr` + `build-esm` | ✅ 已落地（A-class）：fork 暴露 `mmdModelSolveIk` 导出，app 经 `ikSolverIndex` 回退重解，比自建 2-bone IK 更根治 | **已完成（见 §五）** |
| **15** | `VmdLoader` 无 `dispose()` | — | 🟢 无状态需释放，非缺陷 | **忽略** |

### C 类 — 构建/副作用/知识（与源码改动无关）

条目 12/18/21/22：时序文档、移除 monkey-patch、side-effect 导入、MPR 动态导入。**改 fork 无意义。**

### D 类 — 上游健壮性缺失（ADR-192 审核补遗发现，不在原 23 处台账）

> 2026-07-28 增补。来源：用户预感"抛开上游处理模型物理的情况，巨容易失效+不可控"→ 审核物理子系统发现。原 23 处台账是"接口缺口"，D 类是"运行时健壮性缺失"，属新类别。

| 缺口 | 现状（本地兜底） | fork 根治 | 编译路径 | 划算度 | 批次优先级 |
|------|----------------|----------|---------|--------|-----------|
| **`MmdWasmPhysicsRuntimeImpl` 无 disposed 守卫** | virtual-skirt/ground-collision 的 `dispose()` 靠 try/catch 兜底 impl 已销毁时的调用 | impl 加 `isDisposed` 标志，方法调用自动 no-op | `build-wasm-mpr` + `build-esm` | 🟡 中（HMR/场景切换触发，非高频） | **P2 搭车** |
| **`addRigidBody`/`addConstraint` 返回 boolean 不抛异常** | virtual-skirt 调用方手动检查返回值 + `logWarn`（ADR-192 审核补遗刚补） | 失败抛异常或返回详细原因，消除"静默失效"根源 | `build-wasm-mpr` + `build-esm` | 🟡 中（已是适配层补丁，fork 根治可删调用方检查） | **P2 搭车** |

---

## 三、批次执行计划

| 阶段 | 内容 | 编译路径 | 依赖 |
|------|------|---------|------|
| **P0** | ✅ 已落地：vendored 方案——fork 重编 spr/mpr → 拷进 `frontend/vendor/` commit → postinstall 注入 → spr/mpr 含导出、真机风力起效 | — | 无（已完成） |
| **P1** | 原生刚体施力导出（ADR-201，`mmdModelRigidBodyApplyCentralForce` 等，**注：fork 源码里私有字段访问需改用 `physics_model_context()` 访问器，否则 E0616 编译失败**）+ `physics.impl`/`_rigidBodyBundleMap` 提公开 getter | `build-wasm-mpr` + `build-esm` | P0 |
| **P2** | `StreamAudioPlayer` 加 `get audio()`（条目 9）+ D 类两项：`MmdWasmPhysicsRuntimeImpl` 加 `isDisposed` 守卫 / `addRigidBody`/`addConstraint` 失败抛异常（均纯 TS `build-esm`，ADR-192 审核补遗发现） | `build-esm` | P0 |
| **P3（可选）** | `setRuntimeAnimation` reset 时钟 / `onFinishObservable` | `build-esm` | P0 |

> **关键顺序**：P0 是所有 fork 改动能进发版的**共同前提**。建议 P0 单独先跑通（哪怕先只带 P1 一项），验证「改 fork → 编译 → tag → CI 可复现」整条链，再一次性把 P2/P3 搭上，避免为未验证的链路提前铺摊子。

---

## 四、对 CI / 发版的影响（本 ADR 核心结论）

- **P0 已解决（vendored）**：CI `npm ci` 后 postinstall 自动注入 vendor 的 spr/mpr → 产物含 P2 导出，无本地机器依赖，可复现；babylon-mmd 仍锁 1.2.0，无版本跳变风险。
- **升级路径**：fork 再改 → 重编 spr/mpr → 重拷 vendor → commit；postinstall 不变。
- **软风险**：vendor 的 wasm 二进制与 fork 源可能逐渐漂移（手工拷贝），需在 fork 改动后纪律重拷；app 仓体积因 wasm 二进制增长（可接受）。

---

## 五、待办

| # | 待办 | 状态 | 备注 |
|---|------|------|------|
| 1 | P0 拍板 | ✅ | vendored 方案落地，真机风力起效 |
| 2 | CI 干净验证 | ✅ | 完整 `npm ci`（清残留 node/esbuild 僵尸后重跑）已坐实：postinstall 自动注入 spr/mpr，`vendored-patch.test.ts` 3 断言钉结实 patch 生效（含负向验证） |
| 3 | P2 搭车（条目9 audio） | ✅ | fork `0b54302`（`get audio()`）+ app 4 文件（postinstall patch / mmd-adapter / 两个测试 mock）+ 守护测试；2400 单测全绿 |
| 4 | P2 搭车（D 类，ADR-192 审核补遗） | 🟡 fork 已储备 / app 暂缓 | **`isDisposed` 守卫**：fork 侧 getter 已加（技术储备）；app 暂不 patch——virtual-skirt/ground-collision 已通过返回 false 降级，无反射 `isDisposed` 的代码，patch 进去是死代码，等将来 setup 前需主动探测 disposed 时再扩展 postinstall。**"失败抛异常"**：经评估不适用——app 已降级，fork 改抛异常反而破坏 app 的降级契约，不做。 |
| 4b | A-class：WASM 骨骼覆盖后 IK 重解（条目 13） | ✅ | 全链路：fork `7edf759`（`MmdModel::solve_ik` → wasm-bindgen `mmdModelSolveIk`）+ 重编 spr/mpr（导出已核实四处 True）+ vendor 同步注入 + app 6 处补丁（`solveIkNative` / bone-override 4 处 / scene.ts resolver 注入）。**与本地 `TwoBoneIKSolver` 共存**：后者仍服务 feet-adjustment；本项补的是 bone-override 覆盖后重解**原生 IK 链**这块缺口。tsc 0 错、2417 单测全绿。 |
| 5 | `MODEL_WIND_FORCE_SCALE` 标定 | 🟢 待真机 | 风力已起效，按实测摆幅调系数 |
| 6 | vendor/fork 漂移防护 | 🟡 待探明 | fork 每次改 wasm 后必须重拷 vendor，否则两者静默不一致；`vendored-patch.test.ts` 已部分缓解（锚点漂移会报红） |
