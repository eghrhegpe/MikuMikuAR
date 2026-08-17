# ADR-266: Babylon UMD 供应源字节级对齐 — vendored UMD 从 devDependency 同步，check:babylon-lib 守护

> **状态**: ✅ 已采纳（2026-10-23）
> **日期**: 2026-10-23

## 背景

生产（Wails 桌面端）实际运行的 Babylon 不是 node_modules 里的 ESM，而是 `frontend/public/lib/babylon.js`
这个 8.2MB 的手工 vendored UMD：`frontend/vite.config.ts` 的 `external` 把 `@babylonjs/core` /
`@babylonjs/materials` 从 bundle 剔除，改由图里的 `<script>` 提供 `BABYLON` 全局。开发模式相反——
`removeBabylonScripts` 插件把这两条 script 标签删掉，由 Vite 直接 serve node_modules 的 ESM；
Vitest 同样 `isVitest` 内联，跑真 ESM。

两条路径各走各的版本，且没有任何脚本管住 vendored 文件。体检时现场状态：

| 构件 | 版本 | 大小 |
|------|------|------|
| `public/lib/babylon.js`（生产） | 9.14.0 | 8.20MB |
| `public/lib/babylonjs.materials.min.js`（生产） | 9.19 之前 | 0.32MB |
| `node_modules/@babylonjs/core`（开发/测试/类型） | 9.19.0 | — |

即：**测试与开发跑 9.19，生产跑 9.14**——正是「测试全绿、生产黑屏」的温床；升级依赖不会让任何门禁变红。
附带第二处腐化：vendored UMD 末尾写着 `//# sourceMappingURL=babylon.js.map`，而该 `.map` 从未落盘，
生产现场 devtools 每次都要 404 一个不存在的映射，堆栈无从符号化。

## 决策

把「字节相等」而不是「版本号字符串相等」定为不变量——版本号只是漂移的温度计，字节才是供应本身。

1. **供应源内置化**：`babylonjs` / `babylonjs-materials` 作为 devDependency 精确锁定（`--save-exact`，
   与 `@babylonjs/core` 同版本）。npm 上这两个包的 UMD 与 vendored 文件是同源产物（同头部、
   同 `babylonjs@<ver>` 标记），因此无需联网重新打包 Babylon，也无需重建 UMD。
2. **`scripts/sync-babylon-lib.mjs`** 承担同步与校验双职责：
   - `--write`：从 `node_modules/<pkg>` 逐字节复制到 `public/lib/`，并剥掉末尾 `sourceMappingURL` 注释
     （默认不下发 27MB 的 `.map`，也就不会留下悬挂指针；要符号化可 `--write --with-map`）；
   - 默认 `--check`：四条不变量全绿才退 0 —
     I1 `public/lib/babylon.js` == `node_modules/babylonjs/babylon.js`（去 map 注释）、
     I2 材质 UMD 同理、I3 残留的 `sourceMappingURL` 必须有对应 `.map`、I4
     `@babylonjs/core` / `babylonjs` / `babylonjs-materials` 三处版本号必须相等。
3. **门禁接入**：`npm run check:babylon-lib` 进 CI 前端 job 与 `.githooks/pre-push`（只读两个本地文件，
   毫秒级，不依赖网络）；`npm run sync:babylon-lib` 是唯一允许改动 vendored 文件的入口。

## 备选方案

| 方案 | 否决理由 |
|------|---------|
| 只比对版本号字符串 | 版本一致但文件被手改/半途拷贝仍会漏过；且无法发现 I3 的悬挂 map |
| 基线棘轮（记录 9.14→9.19 的漂移并放行） | 把 bug 写进台账，等于宣布「生产可以继续跑旧引擎」；而修法本身零风险（见影响），没有棘轮的必要 |
| 用 esbuild/rollup 把 node_modules 重新打成 UMD | 重新造引擎：shader/材质注册的副作用顺序与官方 UMD 不同，风险远高于收益；npm 官方 UMD 就是我们要的产物 |
| 生产改为打包 ESM、彻底删掉 UMD | 与 `vite.config.ts` 的 external + `BABYLON` 全局方案冲突（ADR-177 的 web 入口走的是另一条路）；迁移面过大，另立任务 |

## 影响

- 新增 `scripts/sync-babylon-lib.mjs`（约 300 行）与 `scripts/__tests__/sync-babylon-lib.test.mjs`（10 例）。
- `frontend/package.json` 新增 devDependencies `babylonjs@9.19.0`、`babylonjs-materials@9.19.0`。
- `frontend/public/lib/babylon.js` 8.20MB → 7.81MB（内容换成 9.19.0，尾部 map 指针摘除）；
  `babylonjs.materials.min.js` 0.32MB → 0.36MB。生产与开发/测试自此跑同一版本。
- 根 `package.json`：`check:babylon-lib`（=守护）、`sync:babylon-lib`（=重建），并纳入 `check:all`。
- `frontend/vite.config.ts` 注释同步（8.3MB → 7.8MB，标注供应源）。
- 后续升级 Babylon 的流程变为：改 `@babylonjs/core` 与两个 UMD devDependency 版本 → `npm install` →
  `npm run sync:babylon-lib` → 提交 vendored 差异。漏做任何一步，CI 与 pre-push 都会红。

## 相关文档

> ADR-177（web 入口变体，不走 UMD）, ADR-254（技术债登记簿）
