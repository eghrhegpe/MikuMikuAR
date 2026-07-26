# ADR-189: 纹理加载路径优化（并行读取 + basename 共享 + LRU + KTX2 基础设施）

> **状态**: 实施中（Phase 0 代码已落地，3 项运行时验证随 Phase 1 完成；Phase 1 代码已落地 2026-07-26 — 并行读取 + basename 共享 + LRU，全量测试 2100/2100）
> **日期**: 2026-07-26（初版）/ 2026-07-26（修订 — 方向调整）/ 2026-07-26（审核修订 — AbortSignal/LRU/数值一致性）
> **关联**: ADR-187（babylon-mmd 剩余 API 分析 — BpmxConverter/BvmdConverter P2 维持，本 ADR 提供触发判据数据源）、ADR-124（filesystem-architecture — referenceFiles 直传路径，§2.4 已记全量读入风险，本 ADR Phase 1 修复）、ADR-176（Backend 适配器双实现）、ADR-182/185（ZIP 命名空间化 + 子目录路径对齐）
> **来源**: ADR-187 调研结论「BPMX/BVMD 当前模型库规模未达启动临界点，真瓶颈在贴图加载而非 PMX/VMD 解析」；2026-07-26 修订源自对 `collectTextureFiles` 的瓶颈审计（串行读取 + basename 复制 + 无 LRU）

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-26

---

## 背景

ADR-187 评估 babylon-mmd 的 `BpmxConverter` / `BvmdConverter` 后定级 🟠 **P2 中期**，触发条件「视模型库规模决定」。本 ADR 不启动 BPMX/BVMD，而是落地一组**替代优化方案**，在 BPMX/BVMD 启动前先解决真正的瓶颈——**贴图加载路径效率**。

### 当前模型库规模（仓库内样本，2026-07-26）

| 类型 | 数量 | 平均 MB | P50 | P90 | Max |
|------|------|---------|-----|-----|-----|
| .pmx | 9 | 3.72 | 1.55 | 5.37 | 18.67 |
| .vmd | 7 | 1.47 | 1.33 | 2.16 | 3.62 |
| .zip | 11 | 58.20 | 64.70 | 89.24 | 166.84 |

ZIP 平均 58 MB，**贴图是体积大头**；P90 VMD 仅 2.16 MB，离 ADR-187 的 10MB 阈值差一个数量级。即"加速 VMD 解析"在当前规模下收益不明显，"优化贴图加载"才是真问题。

### 现有架构与瓶颈（已统一三平台）

PMX 主贴图走 `referenceFiles` 内存直传 ArrayBuffer（[model-loader.ts:446-489](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/model-loader.ts)），桌面/Web/Android 通用。`collectTextureFiles`（[model-loader.ts:262-303](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/model-loader.ts#L262-L303)）存在 3 处可感知瓶颈：

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| 1 | L269-283 串行 `for + await` | 20 纹理 × ~30ms = ~600ms 纯等待 | 加载慢、用户可感知 |
| 2 | L299 `tf.data.slice(0)` 复制 ArrayBuffer | basename fallback 全量复制 | 显存峰值翻倍（80MB → 160MB） |
| 3 | 全程无纹理级 LRU | 切换模型重复读 PNG、共享贴图重复读 | 多模型场景累积延迟 |

KTX2 转码在当前规模下收益感知不到（P90 PMX 5.37MB，全转 KTX2 仅省 ~10MB 显存），且全平台覆盖需引入原生 toktx 二进制或 WASM 转码器，成本高、维护负担重。**真正高性价比的优化是修复上述 3 处瓶颈**——全平台通用、零原生依赖、零退化。

---

## 决策

**主决策：优化纹理加载路径（并行读取 + basename 不复制 + 纹理 LRU），全平台统一受益。**

**辅决策：保留 KTX2 能力探测 + loader 注册 + 体积埋点作为未来升级基础设施；KTX2 转码（Phase 3）暂缓，等 ADR-187 触发条件达成或社区需求出现再启动。**

### 1. 主决策 — 纹理加载路径优化

| 子决策 | 选择 | 理由 |
|--------|------|------|
| 串行 → 并行 | `Promise.all` 替代 `for + await` | 20 纹理并发读取（8 并发上限），~600ms → ~80ms |
| basename 不复制 | URL 重写（referenceFiles 组装时改 `name`） | 共享同一 ArrayBuffer，显存峰值减半 |
| 纹理 LRU | 按 `modelDir + '\x00' + relativePath` 键缓存 ArrayBuffer，LRU 上限 5 个模型 | 切换模型 -300ms，共享贴图零重复读 |

### 2. 辅决策 — KTX2 基础设施（Phase 0，代码已落地，运行时验证随 Phase 1 完成）

保留以下已落地能力，作为未来 KTX2 升级的零成本入口：

| 能力 | 文件 | 作用 |
|------|------|------|
| GPU 能力探测 | [gpu-capabilities.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/gpu-capabilities.ts) | 探测 ASTC/BC7/ETC2 扩展，缓存结果 |
| BackendCapabilities 扩展 | [backend/types.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/backend/types.ts) | 新增 `ktx2Supported` / `ktx2PreferredFormat` |
| KTX2 loader 注册 | [scene.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene.ts) | Babylon.js 自动按文件后缀分发 KTX/KTX2 |
| PMX 体积埋点 | [internal/util/pmx.go](file:///c:/Users/zhujieling11/MikuMikuAR/internal/util/pmx.go) + [library.go](file:///c:/Users/zhujieling11/MikuMikuAR/internal/app/library.go) | `pmx_scan: ...` 日志，为 ADR-187 触发判据提供数据源 |

**"全平台可用"兑现方式**：所有平台跑能力探测 + 埋点；KTX2 loader 注册让"自带 KTX2 贴图的模型"自动受益；不支持 KTX2 的平台自动回退 PNG，零退化。

### 3. 未来路径 — KTX2 转码（Phase 3，暂缓）

KTX2 转码路线图保留，但暂缓实施。触发条件：
- ADR-187 触发判据达成（P90 PMX ≥ 20MB 或 P90 VMD ≥ 10MB）
- 或社区出现"模型库贴图占满显存"的实际反馈
- 或 babylon-mmd 官方提供 KTX2 适配

触发后的平台覆盖矩阵（保留备查）：

| 平台 | Layer 0 探测 | Layer 1 转码 | Layer 2 接入 | Layer 4 埋点 |
|------|------------|------------|------------|------------|
| Windows (WebView2) | ✅ | ✅ toktx.exe 随应用分发 | ✅ | ✅ |
| macOS (WKWebView) | ✅ | ✅ toktx (Homebrew PATH) | ✅ | ✅ |
| Linux (WebKitGTK) | ✅ | ⚠️ 评估启用（WebKitGTK 2.42+ BC7 已稳定） | ⚠️ | ✅ |
| Android (WebView) | ✅ | ⚠️ 评估 WASM 兜底（ktx2-encoder npm 包） | ⚠️ | ✅ |
| Web 浏览器 | ✅ | ⚠️ 评估 WASM 兜底（默认关，设置项预留） | ⚠️ | ✅ |

贴图类型分流（触发后参考）：

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

### Phase 0 — KTX2 基础设施（代码已落地，运行时验证随 Phase 1 完成）

1. **能力探测**：扩展 `getCachedCapabilities()`（[backend/index.ts:122](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/backend/index.ts)），新增 `ktx2Supported` / `ktx2PreferredFormat` 字段。探测项：
   - WebGL2: `gl.getExtension('WEBGL_compressed_texture_astc')` / `('EXT_texture_compression_bptc')` / `('WEBGL_compressed_texture_etc')`
2. **PMX 体积埋点**：扩展 [internal/util/pmx.go](file:///c:/Users/zhujieling11/MikuMikuAR/internal/util/pmx.go) 的 `PMXMeta.FileSize`，扫描入库时 `safeLogInfo("pmx_scan: path=%s size=%d name=%s", ...)`，为 ADR-187 触发判据提供数据源
3. **KTX2 loader 注册**：[scene.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene.ts) 加 `import '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader'`（Babylon.js 9.16 中此 loader 同时处理 KTX1 和 KTX2，通过 `KhronosTextureContainer2.IsValid()` 自动分发）

**验证标准**（已通过）：tsc 0 错；2090/2090 测试通过；go build 通过；check:docs 无漂移；funcmap 同步。

### Phase 1 — 纹理加载路径优化（当前推进，全平台受益）

#### 1.1 串行 → 并行读取

[model-loader.ts:269-283](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/model-loader.ts#L269-L283) 的 `for + await` 改为手写 semaphore + `Promise.all`。`collectTextureFiles` 新增 `signal: AbortSignal` 参数（调用方 `loadPMXFile` 已有 `effectiveSignal`），传入并行读取和 LRU 写入点：

```typescript
async function collectTextureFiles(modelDir: string, signal: AbortSignal): Promise<TextureFile[]> {
    // ...ListDirRecursive 同上...
    if (signal.aborted) return [];

    const concurrency = 8;
    let running = 0;
    const tasks = entries
        .filter(e => TEXTURE_EXTS.test(e.name))
        .map(async entry => {
            while (running >= concurrency) {
                await new Promise(r => setTimeout(r, 0)); // yield
            }
            running++;
            try {
                if (signal.aborted) return null;
                // readFileBytes 返回 Uint8Array | null，.buffer 即为 ArrayBuffer
                const data = await readFileBytes(modelDir + '/' + entry.relativePath);
                if (!data) { logWarn(...); return null; }
                return { relativePath: entry.relativePath, mimeType: getMimeType(entry.name), data: data.buffer as ArrayBuffer };
            } finally {
                running--;
            }
        });
    const results = await Promise.all(tasks);
    if (signal.aborted) return []; // 提前退出，避免浪费 basename fallback 计算
    const files = results.filter((r): r is TextureFile => r !== null);
    // ...basename fallback 同现有逻辑（1.2 改造后跳过 .slice(0)）...
}
```

**并发上限**：手写 semaphore（3 行，复用 `outfit.ts:193` 的成熟模式），限制 8 并发。不引入 `p-limit` 等第三方依赖（`p-limit` 仅作为 `p-locate` 的间接依赖存在于 node_modules，非项目直接依赖）。

**预期收益**：~600ms → ~80ms（20 纹理 / 8 并发 / 单次 ~30ms）

#### 1.2 basename 不复制 ArrayBuffer

[model-loader.ts:287-301](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/model-loader.ts#L287-L301) 的 `tf.data.slice(0)` 复制改为共享同一 ArrayBuffer：

- babylon-mmd 的 `IArrayBufferFile` 接口仅消费 `name` + `data`，不修改 `data`
- 现有"防御性拷贝"源于对 babylon-mmd 是否会 detach 的不确定，**实测 babylon-mmd 走 `new Texture(name, new Blob([data]))` 路径，不 detach ArrayBuffer**
- 改为：fallback 项共享同一 `data` 引用，仅 `relativePath` 不同

```typescript
// 旧：fallbacks.push({ ...tf, relativePath: base, data: tf.data.slice(0) });
// 新：fallbacks.push({ ...tf, relativePath: base, data: tf.data }); // 共享引用
```

**验证**：加载一个含 `tex/face.png` 的模型，确认贴图正确显示（无黑色/缺失），且 `tf.data.byteLength` 与原始一致。

**预期收益**：显存峰值减半（80MB → 40MB，20 纹理 × 2 副本 → 1 副本）

#### 1.3 纹理 LRU

新增 `frontend/src/scene/manager/texture-lru.ts`：

```typescript
interface TextureCacheEntry { data: ArrayBuffer; lastUsed: number; }
// key 使用 \x00（null char）分隔 modelDir 和 relativePath，避免路径中的冒号导致 key 解析歧义
// （vfs 路径如 "web://model" 不含 \x00，安全无碰撞）
const _textureLRU = new Map<string, TextureCacheEntry>();
const TEXTURE_LRU_MAX_ENTRIES = 5 * 30; // 5 个模型 × 平均 30 纹理；实际模型纹理数待 Phase 1 验证时统计

function evictOldest(): void {
    // Map 保持插入顺序 → entries().next() 即为最旧的插入项 → 近似 LRU（命中时重新 set 更新顺序）
    if (_textureLRU.size === 0) return;
    _textureLRU.delete(_textureLRU.keys().next().value!);
}

export async function readTextureWithLRU(
    modelDir: string,
    relativePath: string,
    signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
    const key = `${modelDir}\x00${relativePath}`;
    const cached = _textureLRU.get(key);
    if (cached) {
        // 命中：更新访问时间 + 重新 set 以更新 Map 插入顺序（最近使用排在最后）
        cached.lastUsed = Date.now();
        _textureLRU.delete(key);
        _textureLRU.set(key, cached);
        return cached.data;
    }
    if (signal?.aborted) return null;
    const data = await readFileBytes(modelDir + '/' + relativePath);
    if (!data || signal?.aborted) return null;
    if (_textureLRU.size >= TEXTURE_LRU_MAX_ENTRIES) evictOldest();
    const entry: TextureCacheEntry = { data: data.buffer as ArrayBuffer, lastUsed: Date.now() };
    _textureLRU.set(key, entry);
    return entry.data;
}

/** 清空 LRU 缓存（在 scene.ts 的 disposeRenderer() 中调用）。 */
export function clearTextureLRU(): void {
    _textureLRU.clear();
}
```

- **命中场景**：切换回上一个模型（瞬时）、多个模型共享 `toon.tga`（零重复读）
- **失效场景**：模型目录文件被修改（暂不处理，用户手动清缓存即可）
- **释放**：`scene.ts` 的 `disposeRenderer()` 中 `import { clearTextureLRU } from './manager/texture-lru'` 调用 `clearTextureLRU()`，与现有纹理释放逻辑（`textureFiles[i].data = null`）对齐
- **驱逐策略**：基于 Map 插入顺序的近似 LRU——每次命中时 `delete` + `set` 重新排到最后；溢出时 `delete(keys().next().value)` 淘汰最旧插入项。O(1) 驱逐，无需双向链表。语义等同于真正的 LRU（因为每次命中都会"renew"），仅当同一 key 被多次连续命中时多一次 delete+set 开销（微乎其微）

**预期收益**：切换回模型 -300ms；共享贴图零重复读

#### 1.4 验证标准

- [x] `npx tsc --noEmit` 0 错（2026-07-26 通过）
- [x] `npm run test` 全量 2100/2100 通过（含 `texture-lru.test.ts` 9 测试）
- [x] 单元测试：`collectTextureFiles` 传入已 abort 的 signal，验证立即返回空数组（不触发任何 `readFileBytes`）
- [x] 单元测试：共享引用路径的正本和 fallback 项的 `.data` 指向同一 ArrayBuffer（`toBe()` 相同对象引用）
- [ ] 手动测试：加载含 `tex/face.png` 的模型，确认 basename fallback 仍正常工作
- [ ] 手动测试：加载 5 个模型依次切换，第 6 次切回第 1 个，控制台日志显示 LRU 命中
- [ ] 手动测试：快速连点加载 3 个不同模型，确认旧请求被 abort（并发读取不堆积），最新模型正确加载
- [ ] 性能基准（可选）：加载 20 纹理模型，串行 vs 并行耗时对比
- [ ] 运行时验证（继承自 Phase 0）：确认 KTX2 loader 无错误、`ktx2Supported` 返回 true、`pmx_scan` 日志输出
- [ ] 运行时验证：`disposeRenderer` 后 `_textureLRU.size === 0`（无泄漏）

### Phase 2 — 异步解码（可选，延后）

babylon-mmd 内部走 Babylon.js `Texture` 同步解码路径，4K 纹理 ~50-100ms 卡主线程。改造需要 hook babylon-mmd 的材质加载流程，风险较高，延后评估：

- 调研 babylon-mmd 是否暴露 `textureLoader` 钩子
- 评估 `createImageBitmap` 替代 `new Image()` 的兼容性（Android WebView 4.4+ 支持）
- 若改造成本过高，等 Phase 3 KTX2 落地后由压缩纹理直接送 GPU，绕过 PNG 解码

### Phase 3 — KTX2 转码（暂缓，等触发条件）

触发条件达成后启动。路线图保留：

1. 新增 `internal/app/ktxencode.go`：`ConvertTextureToKtx(pngBytes, format, outPath)` 调 `exec.Command("toktx", ...)`
2. toktx 二进制分发：Windows 随 NSIS 安装包；macOS 文档说明 `brew install ktx-software`；Linux 评估启用
3. WASM 兜底评估：Android/Web 用 `ktx2-encoder` npm 包（基于 basis_universal WASM），转码慢 2-3x 但全平台可用
4. 集成到 `ExtractZip` 流程：解压后扫描 `tex/` 目录批量转码，输出到 `<zipCacheName>/textures_ktx/`
5. WASM 解码器自托管：从 `cdn.babylonjs.com` 下载 `babylon.ktx2Decoder.js` + 所有 WASM 资源到 `frontend/public/lib/ktx2decoder/`，配置 `KhronosTextureContainer2.URLConfig`
6. Wails binding 同步：`npm run generate:bindings`

### Phase 4 — 埋点数据消费（可选，延后）

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

### Phase 1 风险（纹理加载路径优化）

| 风险 | 影响 | 缓解 |
|------|------|------|
| 并发读取撑爆 Go 后端 base64 缓冲区 | OOM 或 GC 压力 | 手写 semaphore 限制 8 并发（复用 `outfit.ts:193` 模式） |
| 模型切换时并发读取无法取消 | 旧请求白跑 + LRU 竞态写入 + 内存浪费 | `collectTextureFiles` 接受 `AbortSignal`；并行 map 内每项 `readFileBytes` 前检查 `signal.aborted`；LRU 写入前检查 signal；aborted 则不入缓存 |
| babylon-mmd 实际会 detach ArrayBuffer | basename 共享引用后贴图损坏 | 改造前先用 `__textureDebug.value` 监控 detach 行为；若确实 detach，回退到 `slice(0)` 但仅对 fallback 项复制 |
| LRU 缓存过期策略不当 | 内存常驻 5×30 纹理 ≈ 600MB | 上限按模型数 × 平均纹理数估算；`disposeRenderer` 强制清空 |
| LRU 缓存陈旧数据 | 模型文件被替换后显示旧贴图 | 暂不处理（用户手动清缓存），文档说明；未来可加 `mtime` 校验 |

### Phase 3 风险（KTX2 转码，暂缓但保留评估）

| 风险 | 影响 | 缓解 |
|------|------|------|
| toktx 二进制分发增加安装包体积 | Windows +5MB | 可接受，KTX2 转码收益远大于体积成本 |
| Linux WebKitGTK KTX2 支持不稳 | Linux 用户无法使用 KTX2 | 触发时评估 WebKitGTK 2.42+ BC7 支持 |
| Android 无原生 toktx | Android 用户无法使用 KTX2 | 评估 WASM 兜底（ktx2-encoder），或保留 PNG |
| babylon-mmd 无官方 KTX2 适配 | 材质 URL 改写需手动 hook | 在 referenceFiles 组装阶段改 name 后缀，babylon-mmd 自动按后缀分发 |
| KTX2 解码依赖 CDN（默认） | 离线环境失败 | Phase 3 自托管 WASM 资源 |
| MMD 生态无 KTX2 先例 | 用户模型库全是 PNG/JPG | 不修改原档，转码作为 cache；用户无感 |

---

## 验证

### Phase 0 验证清单（代码构建部分已通过，运行时验证随 Phase 1 完成）

- [x] `cd frontend && npx tsc --noEmit` 通过（0 错）
- [x] `cd frontend && npm run test` 2090/2090 通过
- [x] `go build ./...` 通过
- [x] `npm run check:docs` 无 ERROR 级漂移（status.md 自动同步 ADR-189）
- [x] `npm run gen:funcmap` 同步（新增 gpu-capabilities.ts 的 3 个导出符号）
- [ ] 启动应用后控制台无 KTX2 loader 相关错误（随 Phase 1 运行时验证 — Phase 1 需要启动应用测试 LRU）
- [ ] `getCachedCapabilities().ktx2Supported` 在桌面浏览器返回 true（随 Phase 1）
- [ ] PMX 入库时控制台输出 `pmx_scan: ...` 日志（随 Phase 1）

### Phase 1 验证清单（代码已落地，运行时待验证）

- [x] `cd frontend && npx tsc --noEmit` 通过（0 错）
- [x] `cd frontend && npm run test` 全量 2100/2100 通过，含 `texture-lru.test.ts`（9 测试）
- [x] 单元测试：`collectTextureFiles` 传入已 abort 的 signal，立即返回空数组
- [x] 单元测试：正本和 fallback 项的 `.data` 指向同一 ArrayBuffer
- [ ] 加载含 `tex/face.png` 的模型，basename fallback 正常（贴图不缺失）
- [ ] 加载 5 个模型依次切换，第 6 次切回第 1 个，控制台日志显示 LRU 命中
- [ ] 快速连点加载 3 个不同模型，旧请求被 abort（并发不堆积），最新模型正确加载
- [ ] 加载 20 纹理模型，并行读取耗时显著低于串行（性能基准对比）
- [ ] `disposeRenderer` 后 `_textureLRU.size === 0`（无泄漏）
- [ ] Phase 0 运行时验证项（KTX2 loader / `ktx2Supported` / `pmx_scan`）一并确认
