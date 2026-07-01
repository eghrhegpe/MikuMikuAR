# 依赖审计报告

> 审计时间：2026-07-01
> 审计范围：`MikuMikuAR/frontend/package.json` 全部依赖（直接 + 传递）
> 工具：`npm audit`、`npm outdated`、`npm ls`

---

## 更新记录（2026-07-01 当日完成）

| 升级项 | 从 | 到 | 效果 |
|--------|----|----|------|
| TypeScript | 4.9.5 | **5.4.5** | 新语法、性能改进 |
| @babylonjs/core | 9.13.0 | **9.14.0** | 小版本更新 |
| ESLint | 8.57.1 | **9.39.4** | flat config、修复 7 个 high 漏洞 |
| @typescript-eslint/* | 6.21.0 | **8.62.1** | 修复 minimatch ReDoS 漏洞 |
| eslint-config-prettier | 8.10.2 | **10.1.8** | ESLint 9 兼容 |
| Vite | 5.4.21 | **6.4.2** | 修复 esbuild SSRF 漏洞 |
| 漏洞数 | 8（1 mod, 7 high） | **0** ✅ | 全部修复 |

配置文件：`.eslintrc.cjs` → `eslint.config.js`（flat config）

---

## 一、总览

| 指标 | 数值 | 状态 |
|------|------|------|
| 直接依赖 | 6 个 | 🟢 |
| 直接 devDependencies | 17 个 | 🟡 |
| 已知漏洞（CVE） | 8 个（1 moderate, 7 high） | 🟡 均为 dev 依赖传递性漏洞 |
| 废弃包 | 0 个 | 🟢 |
| 大版本落后的直接依赖 | 7 个（out of 16） | 🟡 |
| lockfile | ✅ package-lock.json 存在 | 🟢 |

---

## 二、CVE 漏洞详情

来源：`npm audit --registry=https://registry.npmjs.org`

### 🔴 high × 7 — minimatch ReDoS

```
minimatch  9.0.0 - 9.0.6
Severity: high
- ReDoS via repeated wildcards with non-matching literal
- ReDoS: matchOne() combinatorial backtracking via GLOBSTAR segments
- ReDoS: nested *() extglobs generate catastrophic backtracking
```

**传递链：**
```
@typescript-eslint/eslint-plugin@6.21.0
  → @typescript-eslint/utils@6.21.0
    → @typescript-eslint/typescript-estree@6.21.0
      → minimatch@9.x
```

**风险评估：** 低。minimatch 是 ESLint 的传递依赖，**只在开发环境使用**，不进入生产构建。ReDoS 需要用户可控的 glob 模式才能触发，而 ESLint 的 glob 模式是开发者自己写的，不可被外部用户控制。

**修复方案：** 升级 `@typescript-eslint/*` 到 7.x 或 8.x。但 ESLint 8 → 9 是 breaking change，且 `@typescript-eslint` 7 要求 ESLint 8.56+（我们已满足），8 要求 ESLint 9+。

---

### 🟡 moderate × 1 — esbuild dev server SSRF

```
esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send any requests to the development server
and read the response
```

**传递链：**
```
vite@5.4.21 → esbuild@0.21.x
```

**风险评估：** 极低。esbuild 是 Vite 的传递依赖，**只在开发环境使用**。漏洞需要受害者在 dev server 运行时访问恶意网站，攻击窗口很小。生产构建不涉及。

**修复方案：** 升级 Vite 到 6.5+（esbuild 已修复）。但 Vite 5 → 6 是 breaking change。

---

### 漏洞总结

| 级别 | 数量 | 可被利用场景 | 建议 |
|------|------|------------|------|
| high | 7 | dev 环境、需可控 glob | 🟡 可接受，升级 ESLint 时一并修 |
| moderate | 1 | dev 环境、需恶意网站 + dev server 运行 | 🟢 可接受，升级 Vite 时一并修 |

**结论：当前无生产环境漏洞。全部 8 个漏洞均位于开发依赖的传递链上，不影响生产构建。**

---

## 三、版本审计

来源：`npm outdated`

### 生产依赖

| 包 | 当前 | 最新 | 差距 | 风险 | 建议 |
|----|------|------|------|------|------|
| `@babylonjs/core` | 9.13.0 | 9.14.0 | 小版本 | 🟢 低 | 随时可升 |
| `@babylonjs/materials` | 9.14.0 | 9.14.0 | 无 | 🟢 | — |
| `@iconify/iconify` | 3.1.1 | 3.x 最新 | — | 🟢 | — |
| `babylon-mmd` | 1.2.0 | 1.x 最新 | — | 🟡 需关注 | 跟踪上游 changelog |
| `iconify-icon` | 3.0.2 | 3.x 最新 | — | 🟢 | — |

### 开发依赖

| 包 | 当前 | 最新 | 差距 | 风险 | 建议 |
|----|------|------|------|------|------|
| `typescript` | ~~4.5.4~~ **5.4.5** ✅ | 5.x 最新 | 大版本（已升级） | 🟢 | 已完成 |
| `vite` | 5.4.21 | 8.1.2 | 3 个大版本 | 🟡 中 | v5 仍在 LTS，不急 |
| `eslint` | 8.57.1 | 10.6.0 | 2 个大版本 | 🟡 中 | v8 是最后一代传统 config |
| `@typescript-eslint/*` | 6.21.0 | 8.62.1 | 2 个大版本 | 🟡 中 | 跟 ESLint 一起升 |
| `eslint-config-prettier` | 8.10.2 | 10.1.8 | 2 个大版本 | 🟢 低 | 跟 ESLint 一起升 |
| `vitest` | 4.1.9 | 4.x 最新 | 小版本 | 🟢 低 | 随时可升 |
| `@playwright/test` | 1.61.1 | 1.x 最新 | 小版本 | 🟢 低 | 随时可升 |
| `rollup-plugin-visualizer` | 5.14.0 | 7.0.1 | 2 个大版本 | 🟢 低 | 分析工具，不急 |

---

## 四、废弃包检查

来源：`npm ls | grep deprecated`

**0 个废弃包。** 所有直接依赖和传递依赖均未被标记为 deprecated。✅

---

## 五、TypeScript 升级记录

**升级前：** 4.9.5（package.json 写 ^4.5.4，实际安装 4.9.5）
**升级后：** 5.4.5

### 改动

仅 1 处类型修复：

```typescript
// beat-detector.ts
// 之前：
private freqData: Uint8Array = new Uint8Array(0);
// 之后：
private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0);
```

**原因：** TS 5.x 对 `Uint8Array` 的泛型参数收严。`AnalyserNode.getByteFrequencyData()` 期望 `Uint8Array<ArrayBuffer>`，但默认推断为 `Uint8Array<ArrayBufferLike>`（包含 SharedArrayBuffer）。显式声明为 `ArrayBuffer` 即可。

### 验证

- ✅ `tsc --noEmit` 通过
- ✅ `vite build` 通过
- ✅ 测试基线与升级前一致（15 个失败，均为既有问题，非 TS 升级导致）

---

## 六、升级路线建议

### P0：已完成 ✅
- TypeScript 4.9 → 5.4

### P1：建议近期做
1. **`@babylonjs/core` 9.13 → 9.14** — 小版本，直接升，风险低
2. **`vite` 5.4 → 5.x 最新** — 同大版本内小版本，安全补丁

### P2：有空再做
3. **ESLint 8 → 9 + @typescript-eslint 6 → 7** — 顺带修 7 个 high 漏洞
   - ESLint 9 默认 flat config，需要迁移配置
   - 但也可以继续用传统 config（`@eslint/eslintrc`）

### P3：远期规划
4. **Vite 5 → 6** — 顺带修 moderate 漏洞
   - 主要 breaking change：SSR API、部分插件 API
   - 对纯客户端应用影响较小
5. **Vite 6 → 7 / 8** — 差距较大，需要评估
6. **`babylon-mmd` 版本跟踪** — 核心渲染依赖，定期关注 changelog

---

## 七、长期机制建议

| 措施 | 说明 | 成本 |
|------|------|------|
| `dependabot` 或类似工具 | 每周自动提 PR 升级小版本 | 低 |
| CI 加 `npm audit --audit-level=high` | 防止引入新的高危漏洞 | 低 |
| 每季度一次 `npm outdated` 检查 | 手动评估大版本升级 | 中 |
| lockfile 定期更新 | `npm update` 跟新 patch 版本 | 低 |

---

*报告生成时间：2026-07-01*
