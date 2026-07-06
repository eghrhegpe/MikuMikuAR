# 前端代码审计报告 · frontend/src

> 审计日期：2026-07-06
> 范围：`frontend/src/` 全部源码（88 文件 / 32,642 行；不含 `__tests__`）
> 维度：代码质量与坏味道（lint / 类型安全 / 重复 / 死代码 / 魔法数等）
> 方法：静态机械扫描（tsc + ESLint + 自研 Python 坏味道/重复检测）+ 人工定性

---

## 一、执行摘要

**一句话结论：源码质量是健康的，不存在发布阻断级（🔴）问题。主要债务是样式/格式化噪音与少量可安全清理的坏味道。**

| 指标 | 结果 |
|------|------|
| TypeScript 类型检查 (`tsc --noEmit`) | ✅ **0 错误** |
| ESLint ERROR 级（范围内） | ✅ **0** |
| ESLint ERROR 级（范围外·测试文件） | 🔴 **126**（见 §四） |
| ESLint WARN 级（范围内） | 🟡/🟢 **4,563** |
| `@ts-ignore` / `@ts-expect-error` / `debugger` / TODO | 1 / 0 / 0 / 0 |
| `any` 显式（含注释与 `Promise.any`） | 33（真实类型 `any` ≈27，已被 ESLint `no-explicit-any` 捕获） |
| `console.*` 未加守卫 | 175（log 12 / warn 119 / error 30 / info 14） |
| 疑似重复代码块（跨文件或高频） | 192 候选，其中 ~8 处为有意义重复 |

**关键判断**：用户在规划阶段授权"直接修 🔴 阻断项"。由于范围内 🔴 = 0，无需改动源码即可通过类型与 lint 红线。唯一的 🔴 在测试文件（超出范围），已单列，待确认是否顺手修。

---

## 二、严重度总览

| 等级 | 范围 | 数量 | 说明 |
|------|------|------|------|
| 🔴 阻断 | 源码内 | **0** | 无崩溃/CI 失败/类型破裂 |
| 🔴 阻断 | 测试文件（超出范围） | 126 | `no-var`×124 + `prefer-as-const`×1 + `no-prototype-builtins`×1 |
| 🟡 风险 | 源码内 | ~146 | 见 §三（死代码/any/console/全局可变态/重复/大文件） |
| 🟢 优化 | 源码内 | 4,417 | 纯格式化，可一键 `eslint --fix` + `prettier --write` |

---

## 三、详细发现（源码内）

### 🟡 风险项

| # | 发现 | 数量 | 位置/证据 | 建议 |
|---|------|------|-----------|------|
| R1 | 未使用变量/导入（`no-unused-vars`） | 101 | 分散各模块 | `eslint --fix` 可自动移除大部分；人工核对后删除，缩小包体与认知负荷 |
| R2 | 显式 `any`（`no-explicit-any`） | 27 | 多在 `scene/env-water.ts`、`scene/motion/proc-motion-bridge.ts` | 多为访问 Babylon.js 内部 API（`as any` 取 `_tintPostProcess`/`worldMatrix` 缓冲）的性能型转型，**可接受**；但对 `globalThis as any` 的**可变单例**（见 R4）应优先收敛 |
| R3 | `console.*` 未守卫 | 175（ESLint 仅标 18） | `library-core.ts`、`env-bridge.ts`、`scene-serialize.ts`、`outfit-overlay.ts` 等 | 多为 catch 中 `console.warn/error` 吞异常——**用户无感知**。建议：(a) 关键错误上抛到 UI 状态栏；(b) 调试日志用统一 logger + `import.meta.env.DEV` 守卫 |
| R4 | `globalThis as any` 可变全局帧计数器 | 2 处 | `proc-motion-bridge.ts:175-178`、`227-232`（`__gazeCmpFrame`/`__gazeEyeFrame`） | 用模块级 `let` 变量替代挂在 `globalThis` 上的 `any` 单例，消除隐式全局态与类型逃逸 |
| R5 | 可抽取重复块 | 3 处具体 | ① `outfit.ts` 网格遍历循环 ×5（`for mi… inst.meshes`）② `scene/render/lighting.ts` 阴影投射注册 ×4（`if (m instanceof Mesh) gen.addShadowCaster`）③ `menus/motion-procmotion-levels.ts` toggle+regenerate ×4 | 抽成 `forEachMesh(inst, cb)` / `addShadowCasters(gen, meshes)` / 表驱动配置，降低后续改错面 |
| R6 | 超大文件（>900 行） | 8 个 | `settings.ts`1365、`lighting.ts`1116、`procedural-motion.ts`1006、`model-manager.ts`971、`library-core.ts`968、`env-water.ts`918、`xpbd-solver.ts`913、`main.ts`870 | 维护性风险：单点改动影响面大。建议按职责切片（如 settings 拆为分组子模块，lighting 拆 shadow/post-process） |

### 🟢 优化项（一键可清）

| # | 发现 | 数量 | 说明 |
|---|------|------|------|
| G1 | 格式化类（`prettier`/`brace-style`/`curly`/`quotes`/`prefer-const`/`eqeqeq`/`no-empty`） | 4,417 | 全部可由 `npx prettier --write "src/**/*.ts"` + `eslint --fix` 一次性归一，**零逻辑改动** |
| G2 | `no-console` 子集 | 18 | 归入 R3 统一处理 |

---

## 四、范围外但需告知的 🔴（测试文件）

`__tests__/` 下有 **126 个 ESLint ERROR 级违规**，若 CI 对测试执行 `npm run lint` 将直接失败：

- `model-manager.test.ts`：`no-var` ×124、`no-prototype-builtins` ×1
- `env-bridge.test.ts`：`prefer-as-const` ×1

修复方式为纯机械（`var`→`let`/`const`、`Object.prototype.hasOwnProperty.call`、字面量断言改 `as const`），**无逻辑变更、低风险**。但此部分**超出本次约定的审计范围**（用户选择"源码全部"而非"含测试"），故未自动修改，待确认。

---

## 五、整改优先级（建议）

| 优先级 | 动作 | 范围 | 风险 | 命令（就绪） |
|--------|------|------|------|--------------|
| **P0** | 修测试文件 126 个 lint error（若 CI  lint 测试） | 测试 | 低 | `eslint src --ext .ts --fix` 后人工复核测试 |
| **P1** | 清 101 未使用变量 + 收敛 `globalThis as any` + 统一 console/logger | 源码 | 低–中 | `eslint --fix` + 人工 R4/R3 |
| **P2** | 抽取重复块（R5）+ 大文件切片（R6） | 源码 | 中 | 人工重构，每步 build 验证 |
| **P2** | 格式化归一 4,417 警告 | 源码 | 极低 | `prettier --write` + `eslint --fix` |

> 所有代码改动遵循"小步快跑 + 改完即 `tsc`/`build` 验证"。本次在范围内无需改动即可满足红线。

---

## 六、附录：原始数据与复现

| 产物 | 路径 |
|------|------|
| 坏味道扫描原始表 | `docs/audit/raw/smell-scan.md` |
| ESLint ERROR 明细 | `docs/audit/raw/eslint-errors.md` |
| tsc 日志 | `docs/audit/raw/tsc.log`（空，0 错误） |
| ESLint 全量 JSON | `docs/audit/raw/eslint.json` |

复现命令：
```bash
cd frontend
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src --ext .ts --format json > ../docs/audit/raw/eslint.json
```
