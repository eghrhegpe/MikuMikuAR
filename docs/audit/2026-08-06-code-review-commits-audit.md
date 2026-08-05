# 最近 50 提交 code_review 审核（7 高价值目标 + 修复闭环）

**日期**: 2026-08-06
**发现方式**: `code_review` 工具（独立审核 agent，只读）+ 主线程人工核实（源码走查验证 P2 真实性与修复正确性）
**审核范围**: 最近 50 条提交中筛选出的 7 条高价值目标（资源生命周期 / 并发 / 启动时序三类高风险）
**参考**: AGENTS.md「审核代码可用性」5 维度标准
**总体结论**: 有条件通过 → 已修复 2×P2 代码缺陷 + 补齐 4 处测试缺口 + 1 处诊断增强后转通过

---

## 1. 目标筛选过程

从 `git log --oneline -50` 全量扫描，按「类型分布 + 改动规模 + 风险域」三维筛选：

| 排除类别 | 理由 |
|----------|------|
| P1–P7 脚本卫生收口（c6f46809…0855557f） | 批量机械改动，脚本层非运行时核心 |
| 纯 docs / 知识卡 / ADR / release notes | 无运行时代码 |
| CI YAML / version bump / chore | 低风险 |

**入选 7 条**（🔴 高价值）：

| 提交 | 内容 | 风险域 |
|------|------|--------|
| `20d8f470`「更新」 | init.ts 175 行重构：RuntimeEvents 订阅收敛到 `registerRuntimeEventHandlers()` | 启动时序（提交信息无意义但内容最重） |
| `a4c61729` | library-core 两处 panel 泄漏 + `ensureModelMeta` 并发覆盖 | 资源泄漏 + 并发竞态 |
| `8273aff0` | env-ground 涟漪纹理 dispose 跳过（P2） | 跨模块引用生命周期 |
| `876c48cd` | env-terrain onReady 陈旧回调 isDisposed 守卫 | 异步回调过期 |
| `19260be5`+`905dd778` | 按钮无响应根治（side-effect import / 加载锚点） | 模块加载顺序 |
| `511b03ca` | camera-vmd GPU 资源泄漏补 dispose | 资源配对 |

---

## 2. 审核结果总览

| 提交 | 发现数 | 级别 | 处置 |
|------|--------|------|------|
| `20d8f470` | 1 | P3（文档漂移） | ✅ 已由后续提交修复，无需处理 |
| `a4c61729` | 2 | P3 ×2（测试缺口） | ✅ 已补 2 个测试文件 |
| `8273aff0` | 2 | P3 ×2（测试缺口 + 魔法字符串） | ✅ 测试缺口已补；魔法字符串留作可选 |
| `876c48cd` | 1 | P3（测试样板重复，纯优化） | ⬜ 可选优化，未动（收益低且现有测试正确） |
| `19260be5` | 1 | P3（静默跳过无诊断） | ✅ 已加 logWarn 诊断 |
| `905dd778` | 2 | **P2**（锚点无回归测试）+ P3（急切子树求值无容器） | ✅ P2 已补锚点回归测试；P3 设计级建议留档 |
| `511b03ca` | 1 | **P2**（双重 dispose，conf 0.75） | ✅ 已核实并修复 |

---

## 3. 重点发现详情

### 3.1 [P2] `511b03ca` — clearCameraVmd 双重 dispose（已核实 ✅）

**根因**：`clearCameraVmd`（camera-vmd.ts:68-80）在 vmd 模式下先调 `_switchModeCallback('orbit')` → `switchCameraMode('orbit')`（camera.ts:419-437）对 `oldCam`（即 MmdCamera）执行 `detachControl + removeCamera + dispose`，随后 74-75 行又 `removeCamera + dispose` 第二次。

**核实链**（主线程源码走查）：
1. `setSwitchCameraModeCallback(switchCameraMode)`（camera.ts:317）确认回调即 `switchCameraMode`
2. vmd 模式切回时 `oldCam = getCurrentCamera()` 就是 MmdCamera（camera.ts:419-437）
3. 当前 Babylon dispose 幂等所以不崩，但会重跑完整释放（含 `releaseRenderPassId` 遍历所有 mesh）+ 重复触发 `onDisposeObservable`；库硬化 dispose 即爆

**修复**（`afdb24f1`）：回调路径与手动释放路径改为互斥（`else` 分支），保留原提交"非 vmd 路径补 dispose 修泄漏"的意图。

```diff
     if (_mmdCamera && scene) {
         if (getCameraMode() === 'vmd' && _switchModeCallback) {
+            // switchCameraMode('orbit') 已对当前相机（即 MmdCamera）执行
+            // detachControl + removeCamera + dispose，此处不能再释放第二次。
             _switchModeCallback('orbit');
+        } else {
+            // 非 vmd 模式（如 orbit 下预载 VMD 后清除）回调不会处理，手动释放 GPU 资源。
+            scene.removeCamera(_mmdCamera);
+            _mmdCamera.dispose();
         }
-        scene.removeCamera(_mmdCamera);
-        _mmdCamera.dispose(); // 释放 GPU 资源（与 loadCameraVmd 重载路径对称）
         _mmdCamera = null;
         _cameraAnimationHandle = null;
         clearCameraVmdState();
     }
```

**验证**：camera 目录 4 文件 63 测试全绿。

### 3.2 [P2] `905dd778` — main.ts 加载锚点无回归测试（已核实 ✅）

**背景**：v1.9.0 P0——menus 子系统锚点丢失后从未加载，nav-actions 接线 + 桥接注册全部静默缺失，且现有 240+ 测试文件没有一个 import main.ts / library-setup / nav-actions，P0 复发无 CI 拦截。

**修复**（`afdb24f1`）：新增 `main.boot-anchor.test.ts`——真实 import main.ts，mock 锚点链外重依赖（bootstrap/SW/scene/menu 树，**桥接模块不 mock**），断言 `navAction`/`toggleOverlayMode`/`handleAndroidBack`/`navLabel`/`initLibrary`/`refreshLibrary` 六桥接注册生效。锚点被删/注册被移进函数 → 断言失败 → CI 拦截。

**验证**：锚点测试 3/3 通过。

### 3.3 [P3] 测试缺口与诊断（`eb6600b3` 一并补齐）

| 来源提交 | 缺口 | 补法 |
|----------|------|------|
| `a4c61729` | `ensureModelMeta` 并发合并修复**零测试**（防回退到"开头快照一次"旧实现） | `library-core.model-meta-concurrency.test.ts`：双不相交路径并发 + 手动控制 `GetModelMetaBatch` resolve 顺序，断言后完成者不覆盖先完成者 |
| `a4c61729` | grid 模式 dispose 链**无回归测试**（防 renderGridMode/透传层丢 return 致 observer 泄漏） | `library-core.grid-dispose.test.ts`：断言 renderCustom 返回函数 + 调用后 `safeDispose(panel)` 生效 + 重建每轮拿到新 dispose |
| `8273aff0` | 涟漪复位行（`_groundRipples=null`）**无测试保护**（删掉不报错） | env-ground.test.ts 补 deactivation leg：重建（改 seed 42→43）→ 停用涟漪 → 原地改 roughness → 断言恢复的是 seed 43 新 normal 而非 42 陈旧 bump |
| `19260be5` | `bindBtn` 空元素**静默跳过**（DOM 漂移时按钮死掉无信号） | nav-actions.ts：bindBtn 加 `id` 参数，缺失时 `logWarn`（`MODE !== 'test'` 才输出，测试环境静默） |

**验证**：library-core 全套 103 测试、env-ground 25、menu 129 + 锚点 3 全绿。

---

## 4. 修复闭环

| 提交 | 内容 | 验证 |
|------|------|------|
| `afdb24f1` | fix(camera): 消除 clearCameraVmd 双重 dispose + 补 main.ts 加载锚点回归测试 | camera 63 ✓ / 锚点 3 ✓ |
| `eb6600b3` | test: 补齐 a4c61729/8273aff0/19260be5 审核发现的测试缺口与诊断 | library-core 103 ✓ / env-ground 25 ✓ / menu 129 ✓ |

---

## 5. 剩余可选项（未处理，均为低优先）

| 来源提交 | 事项 | 级别 | 建议 |
|----------|------|------|------|
| `876c48cd` | env-terrain 两个新测试 spy 样板重复 ~10 行 | P3 纯优化 | 抽 `captureOnReady(scene)` helper；不影响正确性 |
| `8273aff0` | `'groundRippleTex'` 魔法字符串跨模块（env-ground ×2 + env-water-fx 创建） | P3 可维护性 | 导出共享常量 `GROUND_RIPPLE_TEX_NAME`，改名不再静默失配 |
| `905dd778` | main.ts 急切导入整个 menus 子树，模块求值抛错会白屏且无错误捕获层 | P3 设计 | 保留锚点但保证子树顶层副作用永不抛错（现有 null 守卫已兜底）；或 bootstrap 内 try/catch 动态 import |

---

## 6. 经验与建议

1. **提交信息与内容脱节要警惕**：`20d8f470`（提交信息「更新」）恰恰是 50 条里运行时改动最大的，code_review 前应优先扫这类异常提交。
2. **「修复型提交」的测试缺口是系统性风险**：a4c61729 / 8273aff0 / 511b03ca / 905dd778 都是修复提交，其中 3 个的修复点没有对应回归测试——修复本身正确，但回退无人拦截。建议：修复类提交强制带回归测试（可参考 `main.boot-anchor.test.ts` 的"真实入口 + mock 外围"模式）。
3. **双重释放/生命周期问题优先用 code_review 的 commit 级审核**：conf 0.75 的发现经主线程源码走查全部证实，工具给出精确 diff 修复建议，修复成本低、收益高。
4. **测试 mock 需对齐真实语义**：`library-core.grid-dispose` 的 config mock 必须透传 `cardContainer` 返回值（真实 ui-card.ts 行为），否则 dispose 链在测试中丢失、测试失真——mock 与真实的语义偏差本身也会掩盖回归。

---

## 审核标准参考

- 审核执行标准见 `AGENTS.md` → `# 审核代码可用性`
- 相关 ADR: ADR-238（core→menus 桥接）、ADR-226（地面 spec 单源）、ADR-017（Android 返回键）
- 术语规范: `docs/terminology.md`
