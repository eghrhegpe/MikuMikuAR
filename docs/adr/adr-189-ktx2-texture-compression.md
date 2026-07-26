# ADR-189: 全平台 KTX2 纹理压缩优化（替代 BPMX/BVMD 方案）

> **状态**: 实施中（Phase 0 — 基础设施落地中）
> **日期**: 2026-07-26
> **关联**: ADR-187（babylon-mmd 剩余 API 分析 — BpmxConverter/BvmdConverter P2 维持，本 ADR 提供触发判据数据源）、ADR-124（filesystem-architecture — referenceFiles 直传路径）、ADR-176（Backend 适配器双实现）、ADR-182/185（ZIP 命名空间化 + 子目录路径对齐）
> **来源**: ADR-187 调研结论「BPMX/BVMD 当前模型库规模未达启动临界点，真瓶颈在贴图加载而非 PMX/VMD 解析」

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-26

---

## 背景

ADR-187 评估 babylon-mmd 的 `BpmxConverter` / `BvmdConverter` 后定级 🟠 **P2 中期**，触发条件「视模型库规模决定」。本 ADR 不启动 BPMX/BVMD，而是落地一组**替代优化方案**，在 BPMX/BVMD 启动前先解决真正的瓶颈——**贴图加载与显存占用**。

### 当前模型库规模（仓库内样本，2026-07-26）

| 类型 | 数量 | 平均 MB | P50 | P90 | Max |
|------|------|---------|-----|-----|-----|
| .pmx | 9 | 3.72 | 1.55 | 5.37 | 18.67 |
| .vmd | 7 | 1.47 | 1.33 | 2.16 | 3.62 |
| .zip | 11 | 58.20 | 64.70 | 89.24 | 166.84 |

ZIP 平均 58 MB，**贴图是体积大头**；P90 VMD 仅 2.16 MB，离 ADR-187 的 10MB 阈值差一个数量级。即"加速 VMD 解析"在当前规模下收益不明显，"压缩贴图"才是真问题。

### 现有架构（已统一三平台）

PMX 主贴图走 `referenceFiles` 内存直传 ArrayBuffer（[model-loader.ts:446-489](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/model-loader.ts)），桌面/Web/Android 通用。`collectTextureFiles` 一次性全量读入 PNG/JPG 字节（ADR-124 §2.4 已记风险），无贴图级 LRU，无压缩纹理支持。

---

## 决策

**采用 KTX2 + Basis Universal 作为贴图压缩格式，分层落地：能力探测 → 桌面端 Go 后端 toktx 转码 → 运行时透明接入 → 体积埋点。保留作者原档（不改 PMX 文件本身），转码结果作为 cache 与 ZIP cache 同生命周期。**

### 1. 平台覆盖矩阵

| 平台 | Layer 0 探测 | Layer 1 转码 | Layer 2 接入 | Layer 4 埋点 |
|------|------------|------------|------------|------------|
| Windows (WebView2) | ✅ | ✅ toktx.exe 随应用分发 | ✅ | ✅ |
| macOS (WKWebView) | ✅ | ✅ toktx (Homebrew PATH) | ✅ | ✅ |
| Linux (WebKitGTK) | ✅ | ❌ 首期不启用 | ❌ 首期不启用 | ✅ |
| Android (WebView) | ✅ | ❌ 保留 PNG（无原生 toktx） | ❌ | ✅ |
| Web 浏览器 | ✅ | ❌ 默认关闭（设置项预留） | ❌ | ✅ |

**"全平台可用"兑现方式**：所有平台都跑 Layer 0 探测 + Layer 4 埋点；Layer 1/2 按平台能力差异化启用；不支持的平台自动回退到现有 PNG 路径，零退化。

### 2. 已锁定的子决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | Linux 首期 | 不启用转码，仅探测记录 | WebKitGTK KTX2 支持驱动依赖性强，旧 Intel GPU 可能失败；首期风险可控 |
| 2 | KTX2 cache 位置 | 同级 `<zipCacheName>/textures_ktx/` | 与原 `textures/` 平行，清缓存时一起清；cache 体积翻倍可接受（KTX2 通常为原 PNG 25%） |
| 3 | PMX 体积埋点 | 同期落地 | 零边际成本（已动 internal/util/pmx.go 附近代码）；为 ADR-187 触发判据提供客观数据源 |

### 3. 贴图类型分流

| 贴图类型 | 编码 | toktx 参数 |
|---------|------|-----------|
| 颜色贴图（diffuse/漫反射） | ETC1S | `--t2 --encode etc1s --clevel 5 --qlevel 255 --genmipmap` |
| 法线/ORM 贴图 | UASTC | `--t2 --encode uastc --uastc_quality 4 --assign_oetf linear --assign_primaries none --zcmp 22 --genmipmap` |
| Toon/SPA | 跳过 | 小尺寸，转码收益低于风险 |

**判断规则**（按文件名约定）：
- `*diffuse*` / `*color*` / `*albedo*` → ETC1S
- `*normal*` / `*bump*` / `*orm*` / `*specular*` → UASTC linear
- 其他 → ETC1S（保守默认）

---

## 实施路线图

### Phase 0 — 基础设施（无功能改动，本 PR 范围）

1. **能力探测**：扩展 `getCachedCapabilities()`（[backend/index.ts:122](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/backend/index.ts)），新增 `ktx2Supported` / `ktx2PreferredFormat` 字段。探测项：
   - WebGPU: `adapter.features.has('texture-compression-astc' | 'texture-compression-bc' | 'texture-compression-etc2')`
   - WebGL2: `gl.getExtension('WEBGL_compressed_texture_astc')` / `('EXT_texture_compression_bptc')` / `('WEBGL_compressed_texture_etc')`
2. **PMX 体积埋点**：扩展 [internal/util/pmx.go](file:///c:/Users/zhujieling11/MikuMikuAR/internal/util/pmx.go) 读取 PMX Header 的 texture_table 段（纹理数量 + 路径列表，用于推断后缀分布），扫描入库时 `safeLogInfo` + 写入 IndexedDB `stats:<nsStem>` 键
3. **KTX2 loader 注册**：[scene.ts:53-55](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene.ts) 加 `import '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader'`（Babylon.js 9.16 中此 loader 同时处理 KTX1 和 KTX2，通过 `KhronosTextureContainer2.IsValid()` 自动分发）
4. **URLConfig 配置**：延后到 Phase 1（Phase 0 保持 CDN 默认 `cdn.babylonjs.com`，因 Phase 0 无代码路径触发 KTX2 加载）

**验证标准**：tsc 0 错；现有 2075 测试不退化；go build 通过；启动后控制台不报 KTX2 loader 缺失。

### Phase 1 — 桌面端 Go 后端转码（待排期）

1. 新增 `internal/app/ktxencode.go`：`ConvertTextureToKtx(pngBytes, format, outPath)` 调 `exec.Command("toktx", ...)`
2. toktx 二进制分发：Windows 随 NSIS 安装包；macOS 文档说明 `brew install ktx-software`
3. 集成到 `ExtractZip` 流程：解压后扫描 `tex/` 目录批量转码，输出到 `<zipCacheName>/textures_ktx/`
4. WASM 转码器自托管：从 `cdn.babylonjs.com` 下载 `babylon.ktx2Decoder.js` + 所有 WASM 资源到 `frontend/public/lib/ktx2decoder/`，配置 `KhronosTextureContainer2.URLConfig`
5. Wails binding 同步：`npm run generate:bindings`

### Phase 2 — 运行时透明接入（待排期）

1. 新增 `frontend/src/scene/manager/ktx-cache.ts`：`tryKtxConvert({name, data})` 工具函数
2. 接入 [model-loader.ts:446-489](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/model-loader.ts) `collectTextureFiles` 之后
3. 内存释放复用现有 `[fix:gpu-texture-leak]` 模式

### Phase 3 — 埋点数据消费（可选，延后）

1. 设置菜单加"模型库统计"页，展示 PMX 体积直方图、纹理数分布、KTX2 节省字节数
2. ADR-187 触发判据：当用户模型库 P90 PMX ≥ 20MB 或 P90 VMD ≥ 10MB 时，UI 提示"建议启用 BPMX/BVMD 优化"

---

## 与 ADR-187 的关系

本 ADR 是 ADR-187「BpmxConverter/BvmdConverter P2 中期」的**互补方案**：

- ADR-187 维持 P2 定级不变，触发条件已量化（5 条阈值表）
- 本 ADR 的 Layer 4 埋点为 ADR-187 提供客观数据源（PMX/VMD 体积直方图）
- 本 ADR 解决 ADR-187 当时未覆盖的真瓶颈（贴图加载），让 BPMX/BVMD 的边际收益进一步降低
- 当 ADR-187 触发条件达成时，可基于本 ADR 的埋点数据决定是否启动

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| toktx 二进制分发增加安装包体积 | Windows +5MB / macOS 不打包 | 可接受，KTX2 转码收益远大于体积成本 |
| Linux WebKitGTK KTX2 支持不稳 | Linux 用户无法使用 KTX2 | 首期不启用 Linux，仅探测记录；待社区反馈 |
| Android 无原生 toktx | Android 用户无法使用 KTX2 | 保留 PNG 路径，零退化；移动端模型库通常小 |
| babylon-mmd 无官方 KTX2 适配 | 材质 URL 改写需手动 hook | 在 referenceFiles 组装阶段改 name 后缀，babylon-mmd 自动按后缀分发 |
| KTX2 解码依赖 CDN（默认） | 离线环境失败 | Phase 1 自托管 WASM 资源 |
| MMD 生态无 KTX2 先例 | 用户模型库全是 PNG/JPG | 不修改原档，转码作为 cache；用户无感 |

---

## 验证

Phase 0 验证清单：

- [x] `cd frontend && npx tsc --noEmit` 通过（0 错）
- [x] `cd frontend && npm run test` 2090/2090 通过
- [x] `go build ./...` 通过
- [x] `npm run check:docs` 无 ERROR 级漂移（status.md 自动同步 ADR-189）
- [x] `npm run gen:funcmap` 同步（新增 gpu-capabilities.ts 的 3 个导出符号）
- [ ] 启动应用后控制台无 KTX2 loader 相关错误（待运行时验证）
- [ ] `getCachedCapabilities().ktx2Supported` 在桌面浏览器返回 true（待运行时验证）
- [ ] PMX 入库时控制台输出 `pmx_scan: ...` 日志（待运行时验证）
