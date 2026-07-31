# 补充审核 — AI/安全 · 换装 · 物理桥 · Relay

> **审核范围**：`core/ai/`（markdown / config-store / go-adapter / browser-adapter）、`outfit/outfit.ts`、`physics/physics-bridge.ts`、`relay/src/worker.js`
> **审核动机**：`docs/audit/` 既有 9 轮共 41 模块聚焦 3D 渲染链（env/lighting/motion/perception/playback）。本轮补齐**从未审核过的高风险模块**——AI 安全面、换装资源管理、物理桥生命周期、relay 代理。
> **方法**：AGENTS.md 审核流程 5 维度 + 心理模拟；所有结论均已核对源码，非静态推测。

---

## 总体结论

**✅ 通过（含 3 项建议改进）** — 这批模块工程质量显著高于平均水平：并发守护、资源回收、异常契约处理克制到位。无 P1，2 个 P3 + 1 个 P2 + 2 个 P4。

---

## 一、AI / 安全模块 — `core/ai/`

**结论：✅ 通过**

### 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| XSS 免疫（经核实） | `markdown.ts` 全文 | 全程 `createElement` + `textContent`，无一处 `innerHTML`；消费方 `diagnostic-chat.ts:89,226,242` 同样不拼字符串。防 LLM 注入 XSS 的教科书写法，且省去 marked/dompurify 供应链面 ✅ |
| Key 明文不回读前端 | `go-adapter.ts:158-171` | 桌面端只出布尔 `keyConfigured`，符合密钥剥离规范 ✅ |
| 异常契约完整 | `go-adapter.ts:337-350` | `streamChat` 的 `finally` 把 4 个 `evt.On` 退订、清 watchdog、移除 abort 监听、兜底 `AiCancelStream` 全配齐 ✅ |
| 首字节看门狗 | `go-adapter.ts:27,241-253` | 30s 无任何事件主动注入 error 收尾，防按钮永久 streaming 黑盒 ✅ |
| abort/timeout 清理 | `browser-adapter.ts:257-292` | 内部 `AbortController` 合并外部 signal + 可配超时，`finally` 中 `ac.abort()` 确保 generator break/return 时底层 fetch 被中止 ✅ |

### 风险

| 级别 | 文件:行 | 观察 | 建议 |
|------|---------|------|------|
| 🟡 中P3 | `browser-adapter.ts:249-254` | 网页端经 relay 转发时用户 API Key 通过 `Authorization` 头透传 Worker（`worker.js:99-101` 原样转发不落地）。设计上无泄露，但 relay 运营者理论上可见明文 key | 诊断面板 relay 配置处加提示：「经 relay 转发时 Key 会流经该代理，请只填信任的 relay 地址」。默认 relay 为官方自建，可接受 |
| 🟢 低P4 | `worker.js:20-27` | `isAllowedTarget` 不做域名白名单（靠 `ALLOWED_ORIGINS` 防滥用）。缺省 `ALLOWED_ORIGINS='*'` 时该 Worker 是开放转发器（SSRF 面/被刷流量） | 部署文档强调生产**必须**设 `ALLOWED_ORIGINS` 为具体站点；Worker 内对缺省 `'*'` 打印一次告警日志 |

---

## 二、换装模块 — `outfit/outfit.ts`

**结论：✅ 通过**

### 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| last-wins 并发队列 | L523-543 | `_applyingVariantGuard` + `_pendingVariant`：快速切换变体不丢用户点击也不竞态 ✅ |
| 去重加载守卫 | L119-120,517 | `_loadingOutfitsGuard` 防同一模型并发 `loadOutfits` 重复请求 ✅ |
| overlay token 防陈旧 | L584-609 | `Symbol` token 过期时 dispose 孤儿 mesh，防快速切换泄漏 ✅ |
| HEAD 探测并发上限 | L204-219 | 信号量=6，避免数百 `FileExists` 同时发起；每 `await` 点前查 `aborted` ✅ |
| blob URL 全分支回收 | L319,346,362,365 | 加载成功/失败/过期三分支均 `revokeObjectURL` ✅ |

### 风险

| 级别 | 文件:行 | 观察 | 建议 |
|------|---------|------|------|
| 🟠 高P2 | `outfit.ts:336-376` | `_applySlot` 超时分支（5s 未加载完）走 `trySwap`，若 `newTex.isReady()` 仍 false，会再挂一个 `onLoadObservable` 且**无超时兜底**。贴图永远加载不出时该 observer + blob URL 永不释放 | 给 `trySwap` 兜底 observer 加 dispose 超时，或函数级用一个 `AbortController` 统一管控所有异步分支清理 |
| 🟢 低P4 | `outfit.ts:600` | 陈旧 overlay 用 `console.info` 而非统一日志子系统 | 改用 `@/core/logger` 的 `logInfo`/`logWarn` |

---

## 三、物理桥 — `physics/physics-bridge.ts`

**结论：✅ 通过**

### 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| 生命周期同层配对 | L131-138 | `PerFrameUpdateRegistry` 绑定 `scene.onDisposeObservable` 自动清理，HMR 重建不残留；对单测 mock scene 无该 observable 做容错 ✅ |
| dt 钳制 | L159-164 | 非有限值 + 50ms 上限，防后台标签页恢复后大 dt 炸物理 ✅ |
| 回调异常隔离 | L165-167 | 每帧回调经 `safeCallVoid` 包裹，单个回调抛错不中断其余 ✅ |

### 风险

| 级别 | 文件:行 | 观察 | 建议 |
|------|---------|------|------|
| 🟡 中P3 | `physics-bridge.ts:56-65` | `getBoneWorldPosition` 每次 `new Vector3`，被 `virtual-skirt.ts`、`lighting-follow.ts:142` 在**每帧路径**调用，产生 GC 压力 | 增加 `getBoneWorldPositionToRef(model, name, ref)` 变体，热路径复用预分配 Vector3（同 README 已记录的 particles splash `new Vector3` 类问题） |

---

## 与既有审核的衔接

`docs/audit/README.md` 的存量 P1（`lighting.ts` transitionLighting 未调度、`env-water.ts` getScene NPE、`proc-motion-autodance.ts` 零测试）优先级**高于本轮发现**。本轮 🟠P2（`_applySlot` 超时泄漏）建议并入下一轮修复批次，不单独碎片化改动。
