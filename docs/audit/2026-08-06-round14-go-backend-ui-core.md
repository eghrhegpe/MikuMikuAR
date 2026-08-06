# 第 14 轮审核报告 — Go 后端全量 / UI 剩余 / core 剩余

> **日期**: 2026-08-06
> **范围**: 28 模块（Go 后端 15、UI 剩余 8、core 剩余 5）
> **方法**: 4 子代理并行（explore 只读），知识卡 → 源码 → 5 维度 + 4 心理模拟；逐行核对源码
> **结论**: P1×5（已修 3 + 立 ADR 2）、P2×12（已修 4）、P3×24（记录）

---

## 执行摘要

| 集群 | 模块 | 关键结论 |
|------|------|----------|
| Go 后端核心 | app / fileaccess / library / scene / presets / util | 锁分层与原子写达标，但 **mergeUIState bool 无条件覆盖**（P1）与 **mergeEnvState JSON round-trip 零值覆盖**（P1）破坏「部分更新合并」契约；fileaccess 公开绑定绕过 FileAccessor（isSafePath 死代码） |
| Go 后端外围 | proxy / update / watch / zipextract / ktx2 / plaza / llm / httpserver / integration | proxy 下载通道 SSRF 扎实但**主代理/WebSocket 无 SSRF 防护**（P1）；**ExtractZip 无解压总量上限**（P1）；httpserver 知识卡严重过时 |
| UI 剩余 | library-browse / motion-popup / motion-binding-ui / motion-detail-ui / model-detail / model-preset / outfit-ui / nav-actions | 无 P1；P2×4（close 未清 timer、unpin 残留 VMD、loadOutfits null 竞态、disposeNavBindings 零调用） |
| core 剩余 | audio / drop-import / shortcut-app / theme / transform-selection / markdown / logger / toast | **audio 短音频+长 VMD 每帧 seek 0 死循环**（P1）；loadAudioFile Abort 落空（P2）；drop-import 无 try/catch（P2） |

## 🔴 P1 问题

| # | 模块 | 位置 | 问题 | 修复状态 |
|---|------|------|------|----------|
| 1 | audio | audio.ts:518-536 | VMD 同步模式，音频比 VMD 短（`audioTargetTime >= audioDur`）时：播放分支置 0 + 随后漂移纠偏分支 `diff > 0.1` 恒成立**每帧 seek 回 0**——短 BGM+长 VMD 音频永远无法前进、实际无声（audio.sync.test.ts 只调用一次零断言，未捕获） | ✅ 已修：纠偏仅当 `audioTargetTime < audioDur` 时执行，短音频自然播放 |
| 2 | app/config | config.go:338-421 | `mergeUIState` 对 13 个 bool 字段（Animations/BlurBg/FrameCapEnabled 等）**无条件 `dst.X = src.X`**；前端只发部分载荷，缺失字段 unmarshal 得 false → 任何无关 UI 持久化都会静默重置用户设置 | 📋 立 ADR-253（bool→*bool 结构性大改，涉前后端类型双写） |
| 3 | app/config | config.go:314-324 | `mergeEnvState` JSON round-trip 合并，EnvState 除 MirrorPosition/LightingPresetName 外全无 omitempty → src 零值字段覆盖 dst，「preserving dst fields」承诺只在 omitempty 成立；现有测试恰好只断言 omitempty 字段 | 📋 立 ADR-253（字段级合并或全 omitempty+指针） |
| 4 | proxy | proxy.go:312,292-298,549-557 | 主反向代理用 `http.DefaultTransport`（无 SSRF guard）、target 无 scheme 白名单；WebSocket 用裸 `net.Dialer`/`tls.DialWithDialer`——127.0.0.1/私网 target 被直接代理（开放代理+SSRF），违反知识卡「任何 target 必须过 SSRF 校验」 | ✅ 已修：scheme 白名单 + `ssrfGuardedTransport()`（复用 plazaSSRFGuard）+ WebSocket 拨号经 guard |
| 5 | zipextract | zipextract.go:134-186 | `ExtractZip` 无解压总量/单文件上限；`expandZipEntries` 的 2GB 预检只覆盖扫描列表面，解压路径可写满磁盘 | ✅ 已修：单条目超限拒绝 + 累计总量守卫 + `io.LimitReader` 截断兜底 |

## 🟠 P2 问题（已修 4 / 记录 8）

| # | 模块 | 位置 | 问题 | 状态 |
|---|------|------|------|------|
| 1 | audio | audio.ts:282-329 | `loadAudioFile` 仅入口查一次 signal.aborted，await 期间 abort 落空——已取消加载仍创建 blob URL 入播放列表 | ✅ 已修：await 后二次检查 + createObjectURL 后 abort 时 revoke |
| 2 | drop-import | drop-import.ts:80-104 | `handleDroppedFile` 中 arrayBuffer/idbSet/saveModel 无 try/catch，QuotaExceededError 等 reject 无提示 | ✅ 已修：整体 try/catch + `importFailedDetail` 状态提示 |
| 3 | library-browse | library-browse.ts:80-86 | `close` 未清 restore timer + toast（与 dispose 语义不一致） | 📋 记录（行为一致性） |
| 4 | motion-binding-ui | motion-binding-ui.ts:166-168 | `applyIntentToModel` 对无 vmdPath 的 intent 直接 return 不清旧 VMD（广播层已处理，直接调用路径不一致） | 📋 记录 |
| 5 | outfit-ui | outfit-ui.ts + scene/manager/outfit | `loadOutfits` 在途加载返回 null → 换装面板误显「无配置」，需跨 outfit.ts 改动 | 📋 记录（跨模块） |
| 6 | nav-actions | nav-actions.ts:174,233-238 | `disposeNavBindings` 全库零调用，HMR 后按钮监听累积双重 toggle | 📋 记录（一行接线可修，dev 期） |
| 7 | zipextract | zipextract.go:77-81,226-281 | ExtractZip/ImportZip 与 CleanOrphanCache 无互斥，并发解压/清理竞态 | 📋 记录 |
| 8 | zipextract | zipextract.go:817-853 | StartFileServer 无 trustedRoots 白名单 + CORS `*` + 目录列表开启 | 📋 记录 |
| 9 | zipextract | zipextract.go:784-811 | bufferingResponseWriter 全量内存缓冲（500MB 级 OOM） | 📋 记录 |
| 10 | watch | watch.go:122-218,421-428 | RAR 解压无炸弹限制；跨窗口重复 emit watch:newfile | 📋 记录 |
| 11 | update | update.go:268-285 | downloadFile 先无界写盘再校验大小（恶意流式灌数据先写满磁盘） | 📋 记录 |
| 12 | llm | ai_binding.go:72-116 | 取消旧流后事件未按 gen 过滤，新旧流事件交错 | 📋 记录 |

## 🟡 P3 关注项（24 项，节选）

- **fileaccess**：ReadTextFile/WriteTextFile/ReadFileBytes 绕过 FileAccessor 直 os.*，Android content:// 守卫失效，isSafePath 死代码
- **library**：expandZipEntries 用 os.* 绕过 accessor；ScanModelDir 无并发互斥；500MB zip 上限可能误拒大型合法包
- **scene**：BundleScene 非 libRoot 资产退化为 basename 时 zip 内同名覆盖
- **presets**：SaveEnvPreset/SaveMotionPresetToLib 裸 WriteFile 非原子（同模块其他写已原子）
- **util**：ParsePMXHeader 对 <8KB 小文件把 io.EOF 当错误
- **ktx2**：findToktx 未找到返回 ("",nil) 被误判为找到；in-place 覆盖源纹理与卡矛盾
- **plaza**：直连桥 `endsWith('aplaybox.com')` 缺前导点
- **proxy**：handlePlazaDownloadPost 无 MaxBytesReader；StopProxy 注释与实现不符
- **audio**：disposeAudio 未置空 _lastEndedHandler；_crossfadeTo timer 未跟踪；new Blob 用整个 ArrayBuffer 而非视图
- **drop-import**：无并发去重（同一 File 重复 drop）
- **shortcut-app**：dom.btnPlayPause.click() 依赖非空断言；无 unregister 对称 API
- **transform-selection**：syncDragMode skip 守卫只比 id 不比 kind+id
- **markdown**：行内 _italic_ 误伤代码标识符下划线
- **theme**：muted 恒用 factor 0.4，亮色主题对比度可能不足
- **toast**：action onClick 抛错时 removeToast 不执行；无 body 存在性检查

## 知识卡偏差汇总

| 知识卡 | 偏差 |
|--------|------|
| go-httpserver.md | **偏差最大**：声称 IsolateModelDir 信任目录直读+复制+EvalSymlinks+500MB/2GB 上限常量——实际仅 `filepath.Dir`，isSafePath/trustedRoots 死代码 |
| go-proxy.md | 「任何 target 必须过 SSRF 校验」仅对 DownloadFromPlaza 成立，主代理/WebSocket 未实现（本轮已修） |
| go-zipextract.md | 「expandZipEntries 预检总量防炸弹」只在扫描列表面；「无锁、上层加锁调用」实际无锁 |
| go-watch.md | 「去抖后自动导入」实际 Go 侧只 emit，导入由前端完成 |
| go-ktx2.md | 「toktx 缺失优雅跳过」实际空路径逐纹理报错 |
| audio.md | **整卡缺失**（core/audio.ts 音乐播放器无知识卡，仅 audio-bus.md 对应 SFX 总线） |
| shortcut-app.md | camera:ar Ctrl+6 代码中不存在；screenshot 实为 F2 非 Ctrl+F6；缺 toggle:assistant Ctrl+8 |
| logger/drop-import/markdown/toast.md | tests:[] 均已过时（专属测试已存在） |
| model-preset-ui.md | 「preset-manager.ts 数据层」不存在，实际走 wails bindings |
| outfit-ui.md | 「依赖 scene/env/props.ts」实际依赖 scene/manager/outfit |

## 验证

- `go build ./...` + `go vet ./internal/app/` 通过；`go test ./internal/app/` 通过
- 前端 tsc 无新增错误；audio 4 文件 48 用例、drop-import 13 用例、motion-intent 6 用例全绿
- 前端全量 **278 文件 / 4757 用例全绿**
- ADR-253 已立档（merge 两个结构性 P1），gen:status/gen:docsindex 已同步（249 个 ADR）
