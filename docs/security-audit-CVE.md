# 安全审计 CVE 记录

> 运动算法核心 `frontend/src/motion-algos/` 安全审计漏洞清单与缓解状态。
> 审计日期：2026-07-08

---

## P0 — 严重（已修复）

### CVE-001 [CWE-78] OS 命令注入 — VMD 骨骼/模型名称

- **文件**：`vmd-writer.ts` — `encodeBoneName()` / `encodeModelName()`
- **路径**：用户可控名称（VPD 解析）→ 写入 VMD 二进制 → 下游拼接命令/SQL
- **修复**：新增 `sanitizeName()` 函数，去除控制字符（`\x00-\x1F\x7F`）和注入风险字符（`<>;"'\`\\`），确保 Shift-JIS 字节长度合规
- **状态**：✅ 已修复
- **测试**：`vpd-parser-security.test.ts` — buildVmd 名称净化防护（7 tests）

### CVE-002 [CWE-89] SQL 注入 — VMD 模型名写入

- **文件**：`vmd-writer.ts` — `encodeModelName()`
- **路径**：用户可控 `modelName` → 写入 VMD 头 20-byte Shift-JIS 区域
- **修复**：同 CVE-001，`sanitizeName()` 统一处理；20 字节硬上限
- **状态**：✅ 已修复

### CVE-003 [CWE-400] 资源耗尽 — VPD 文件大小

- **文件**：`vpd-parser.ts` — `decodeVPDData()`
- **路径**：超大 VPD 文件 → 内存耗尽
- **修复**：`MAX_VPD_SIZE = 1MB` 入口校验，超限 `throw Error`
- **状态**：✅ 已修复

### CVE-004 [CWE-91] XML 实体注入 — VPD 数字行

- **文件**：`vpd-parser.ts` — `_cleanNumericLine()`
- **路径**：恶意 `<!ENTITY>` / `<!DOCTYPE>` 声明 → XXE 攻击
- **修复**：`_cleanNumericLine()` 增加 `<!ENTITY>` 和 `<!DOCTYPE>` 声明剥离
- **状态**：✅ 已修复

---

## P1 — 高危（已修复）

### CVE-005 [CWE-755] 异常编码崩溃 — VPD 解码

- **文件**：`vpd-parser.ts` — `decodeVPDData()`
- **路径**：`Encoding.convert()` 在恶意编码下可能抛错
- **修复**：所有解码路径包裹 `try/catch`，失败时 `console.warn` 并回退到 UTF-8
- **状态**：✅ 已修复

### CVE-006 [CWE-476] 空指针竞态 — BeatDetector 状态机

- **文件**：`beat-detector.ts` — `attach()` / `dispose()` / `update()`
- **路径**：`dispose() → analyser = null` → 另一个 `update()` 调用 → TypeError
- **修复**：`attach()` 返回 `boolean`，失败时调用 `dispose()` 清理资源；`dispose()` 幂等并清零 `_lastError`
- **状态**：✅ 已修复

### CVE-007 [CWE-755] BeatDetector 静默吞噬错误

- **文件**：`beat-detector.ts` — `attach()`
- **路径**：`AudioContext` 创建失败 → `console.warn` + 静默返回 → 调用方误认为成功
- **修复**：`attach()` 返回 `boolean`；新增 `isAvailable()` 和 `getLastError()` 供 UI 查询；`audio.ts` 调用方根据返回值设置 `beatDetectorAttached`
- **状态**：✅ 已修复

---

## 已缓解 / 已核实

### CVE-008 [CWE-125] 越界读 — VPD 变形骨骼名称

- **文件**：`vpd-parser.ts:148-152`
- **状态**：✅ 已有防护（`posParts.length >= 3 && rotParts.length >= 4` + `isFinite` 检查）
- **测试**：`vpd-parser-security.test.ts` — 越界读防护（8 tests）

### CVE-009 [CWE-400] 资源耗尽 — 无限帧生成

- **文件**：`procedural-motion.ts:186`
- **状态**：✅ 已有防护（`Math.max(0.1, speed)` clamp）

### CVE-010 [CWE-476] 原型污染 — LipSync 形态查找

- **文件**：`lipsync.ts:29-37`
- **状态**：✅ 无风险（使用 `Set.has()`，不查原型链）

---

## P2 — Defense in Depth（已修复）

### CVE-011 [CWE-400] 服务端 VPD 文件大小校验

- **文件**：`internal/app/zipextract.go` — `serveFileWithSizeCheck()`
- **路径**：Go 文件服务器 `basenameFallbackFS` handler 透传 `.vpd` 文件 → 前端下载超大文件
- **修复**：新增 `serveFileWithSizeCheck()` 函数，对 `.vpd` 文件校验大小 ≤1MB（`maxVPDSize`），超限返回 HTTP 413；三处 `http.ServeFile` 调用替换为 `serveFileWithSizeCheck`
- **状态**：✅ 已修复

### CVE-012 [CWE-20] VMD loader 签名验证

- **文件**：`frontend/src/scene/motion/vmd-loader.ts` — `isValidVmd()` / `loadVMDMotion()`
- **路径**：恶意 ArrayBuffer 传入 `loadVMDMotion` → babylon-mmd 解析异常 → 程序崩溃
- **修复**：`loadVMDMotion` 入口处新增 `isValidVmd()` 验证 VMD 签名（前 25 字节 `"Vocaloid Motion Data 0002"`）及最小头部长度（50 字节），非法数据直接拒绝
- **状态**：✅ 已修复

---

## 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/motion-algos/vmd-writer.ts` | 新增 `sanitizeName()`、`UNSAFE_NAME_CHARS` 正则、`MAX_*_NAME_BYTES` 常量 |
| `frontend/src/motion-algos/vpd-parser.ts` | `MAX_VPD_SIZE` 限制、`try/catch` 降级、XML 实体剥离 |
| `frontend/src/motion-algos/beat-detector.ts` | `attach()` 返回 `boolean`、`isAvailable()`、`getLastError()`、资源泄露清理 |
| `frontend/src/outfit/audio.ts` | `attach()` 调用方适配返回值 |
| `frontend/src/scene/motion/vmd-loader.ts` | 新增 `isValidVmd()` 签名验证、`VMD_SIGNATURE` / `VMD_HEADER_MIN` 常量 |
| `internal/app/zipextract.go` | 新增 `serveFileWithSizeCheck()`、`maxVPDSize` 常量，三处 `http.ServeFile` 替换 |
| `frontend/src/__tests__/vpd-parser-security.test.ts` | 新增 29 项安全边界测试 |
| `frontend/src/__tests__/beat-detector.test.ts` | 补充 `isAvailable` / `getLastError` 测试 |
