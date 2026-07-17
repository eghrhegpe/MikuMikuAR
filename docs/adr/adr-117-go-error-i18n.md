# ADR-117: Go 端用户可见错误的 i18n 化

> **状态**: 实施中（Phase 1 完成；契约验证发现 Wails v3 把 Go error stringify 成纯文本，原方案 A 的 `MarshalJSON` 对跨桥无效，已转向"信封方案"，见 §2.6）
> **背景**: ADR-059 已完成前端 i18n 框架（`core/i18n/` + 五语言 bundle + 热切换 + CI 奇偶校验），但 Go 后端返回给前端的**用户可见错误**仍是硬编码中文（如 `fmt.Errorf("未找到 Blender，请在设置中配置路径")`）。当用户切到英文/日文后，前端 UI 已本地化，但弹窗里的 Go 错误仍是中文，造成体验断裂。本 ADR 锁定 Go 错误的 i18n 契约，使前端能用 `t()` 翻译 Go 错误。
> **关联**: [ADR-059](adr-059-i18n-framework.md)（前端 i18n 框架）、[terminology.md](../terminology.md) §三（Go 错误消息规范）

---

## 一、问题边界

### 1.1 现状清点

| 项 | 事实 | 来源 |
|----|------|------|
| Go 用户可见错误 | 硬编码中文字符串，散落于 `internal/app/*.go` | grep `fmt.Errorf("...中文...")` |
| Go 内部错误 | 英文 + `%w` 包装，仅日志 | `runtime.LogErrorf` |
| 前端错误展示 | 直接显示 Go 返回的 `error.Error()` 字符串 | `catch(e) { setStatus(e.message) }` 等 |
| i18n 覆盖 | 前端 `t()` 覆盖 UI 标签/状态消息，**不覆盖** Go 错误 | ADR-059 §六边界声明 |
| 影响范围 | 约 20 处用户可见 Go 错误（`integration.go`/`watch.go`/`dancesets.go` 等） | grep 实测 |

### 1.2 痛点

- **体验断裂**：用户切到 `en` 后，菜单标签变英文，但"未找到 Blender"弹窗仍是中文。
- **无法本地化**：前端 `t()` 无法翻译 Go 返回的字符串，因为 Go 返回的是最终文本而非 key。
- **测试盲区**：Go 错误文本是中文，前端测试无法断言本地化后的错误消息。

### 1.3 与 ADR-059 的边界

ADR-059 §六明确"MVP 阶段不修改 Go 后端"，该边界至今未突破。本 ADR 是该边界的**正式升级**：将 Go 错误从"返回最终文本"改为"返回 error code + 可选 params"，前端用 `t()` 翻译。

---

## 二、方案设计

### 2.1 核心契约：Go 返回 error code，前端翻译

```
Go 端                        前端
─────                        ────
return ErrSoftwareNotFound    catch(e) {
  + params {name:"Blender"}    const {code, params} = parseGoError(e);
                                setStatus(t(`goerr.${code}`, params));
                              }
```

### 2.2 Go 端：结构化错误类型

新增 `internal/i18nerr/errors.go`：

```go
package i18nerr

// UserError 是面向用户的错误，携带 i18n code 与占位符参数。
// 前端通过绑定层解析 code + params，用 t() 翻译。
type UserError struct {
    Code   string            // 形如 "software.notFound"，对应前端 t('goerr.software.notFound')
    Params map[string]string // 占位符，如 {"name": "Blender"}
    msg    string            // 开发期 fallback 文本（中文，仅用于 Go 侧日志/调试）
}

func (e *UserError) Error() string { return e.msg } // Go 侧日志仍可读

func New(code, fallbackMsg string, params ...map[string]string) *UserError {
    p := map[string]string{}
    if len(params) > 0 { p = params[0] }
    return &UserError{Code: code, Params: p, msg: fallbackMsg}
}
```

**改造前**：
```go
return fmt.Errorf("未找到 Blender，请在设置中配置路径")
```

**改造后**：
```go
return i18nerr.New("software.notFound", "未找到 Blender，请在设置中配置路径", map[string]string{"name": "Blender"})
```

`fallbackMsg` 保留中文，用于 Go 侧日志与开发期调试；前端通过绑定层拿到 `Code` + `Params` 后用 `t()` 翻译，不再读 `fallbackMsg`。

### 2.3 绑定层：UserError 跨桥通道（Phase 1 契约验证结论）

> ⚠️ **原方案 A（`MarshalJSON`）已证伪。** 见 §2.6 的完整证据链。结论：Wails v3 在跨桥时把 Go error **stringify 成纯文本**，结构化 `code`/`params` 无法透传，因此 `*UserError` 的 `MarshalJSON` 永远不会以顶层类型被序列化，对跨桥是死代码。

**确立方案：信封方案（`Error()` 内嵌哨兵 JSON 信封）**

既然跨桥只能携带 `.Error()` 字符串，就把结构化数据编码进该字符串：

```go
const EnvelopeMarker = "@@GOERR@@"

func (e *UserError) Error() string {
    env, _ := json.Marshal(struct {
        Code   string            `json:"code"`
        Params map[string]string `json:"params"`
        Msg    string            `json:"msg"`
    }{e.Code, e.Params, e.msg})
    return e.msg + "\n" + EnvelopeMarker + string(env)
}
```

- `e.msg`（中文）在前，供 Go 侧日志直接阅读；
- `\n@@GOERR@@<json>` 在后，前端按哨兵 `lastIndexOf` 提取 JSON 信封（`{code,params,msg}`）再 `t()` 翻译；
- 哨兵位于文本**末尾**，即使外层被 `errs.WrapBindingCallFailedErrorf` 包裹（`"Binding call failed: ...: " + cause.Error()`），前缀包裹文本也不含哨兵，提取不受影响。

（原方案 B 的 `[goerr:code]` 前缀被否决：脆弱、无法携带 params，且不区分"包裹前缀"与"code 前缀"。）

### 2.4 前端：错误翻译工具

新增 `core/i18n/goerr.ts`（从 error 文本按哨兵提取信封）：

```ts
import { t } from './t';

const MARKER = '@@GOERR@@'; // 与 internal/i18nerr.EnvelopeMarker 一致

interface GoErrEnvelope { code: string; params?: Record<string, string>; msg?: string }

export function translateGoError(e: unknown): string {
    const raw = toText(e);
    const idx = raw.lastIndexOf(MARKER);
    if (idx !== -1) {
        try {
            const env = JSON.parse(raw.slice(idx + MARKER.length)) as GoErrEnvelope;
            if (env && env.code) {
                const translated = t(`goerr.${env.code}`, env.params ?? {});
                if (translated !== `goerr.${env.code}`) return translated; // 已翻译
                return env.msg ?? raw; // 未翻译 → 回退信封内中文 msg
            }
        } catch { /* 信封损坏，回退原文 */ }
    }
    return raw; // 旧式 fmt.Errorf 字符串错误
}
```

`toText(e)` 将 `Error` / 字符串 / `{message}` 归一为文本。`t()` 缺失 key 时返回 key 本身（ADR-059），据此判定"未翻译"并回退到信封内 `msg`。

前端所有 `catch(e) { setStatus(e.message) }` 改为 `catch(e) { setStatus(translateGoError(e)) }`。

### 2.5 i18n bundle 新增 `goerr.*` 命名空间

`locales/zh-CN.ts` 新增：
```ts
'goerr.software.notFound': '未找到 {name}，请在设置中配置路径',
'goerr.software.launchFailed': '启动 {name} 失败',
'goerr.file.readFailed': '读取文件失败',
'goerr.dir.notExist': '目录不存在',
'goerr.zip.noPmx': '压缩包内未找到模型文件',
'goerr.cache.writeFailed': '写入缓存失败',
'goerr.android.noExec': 'Android 不支持直接启动外部可执行文件',
'goerr.android.noWatch': 'Android 不支持文件系统监听，请手动导入文件',
'goerr.watch.dirInaccessible': '监听目录不可访问',
'goerr.watch.createFailed': '创建文件监听器失败',
'goerr.screenshot.dirNotSet': '尚未设置截图保存目录，请先截图一次',
'goerr.screenshot.dirCreateFailed': '创建截图目录失败',
'goerr.config.readFailed': '读取配置失败',
'goerr.vmd.emptyPath': 'VMD 文件路径不能为空',
// ... 完整清单见 §五实施路标
```

`en.ts` / `ja.ts` / `ko.ts` / `zh-TW.ts` 同步翻译，CI `i18n-check.mjs --strict` 守门。

### 2.6 Phase 1 契约验证结论（2026-07-17）

**结论：Wails v3 把 Go error stringify 成纯文本跨桥，原方案 A（`MarshalJSON`）对跨桥无效。已确立"信封方案"。**

证据链（Wails v3 `v3.0.0-alpha2.105` 源码）：

1. `pkg/application/messageprocessor_call.go:119-131` — `result, err = boundMethod.Call(...)` 后，所有非 nil `err` 被 `errs.WrapBindingCallFailedErrorf(err, "failed to call binding")` 包裹后返回。
2. `pkg/errs/errors.go` — `wailsError` 的 `cause`/`msg`/`errorType` 字段**全未导出**，且**未实现 `MarshalJSON`**；`Error()` = `"Binding call failed: failed to call binding: " + cause.Error()`。
3. `pkg/application/transport_http.go:354-376`（`httpError`）— 对非 `*CallError` 的 error 返回 `text/plain` = `err.Error()`（仅 `*CallError` 才 marshal 成 JSON；Go 侧 `*UserError` 不属于此类）。
4. `frontend/node_modules/@wailsio/runtime/dist/runtime.js:114-116` — 前端 `runtimeCallWithID` 在 `!response.ok` 时 `throw new Error(await response.text())`，即 reject 值就是上述纯文本字符串。

**推论**：跨桥后前端拿到的只有 `err.message` 字符串（含包裹前缀 + `UserError.msg`），**没有 `code`/`params` 字段**。`UserError.MarshalJSON` 因对象从不以顶层类型进入序列化路径，对跨桥是死代码。

**修正**：结构化数据改由 `.Error()` 字符串内的 `@@GOERR@@` 哨兵 JSON 信封承载（§2.3）。前端 `translateGoError` 按哨兵提取（§2.4）。该方案对所有 transport（桌面 webview / HTTP / Android）一致有效，因为所有路径都 stringify error 进 `.message`。

**已落地（Phase 1 交付物）**：
- `internal/i18nerr/errors.go`：`UserError` + `EnvelopeMarker` + `Error()` 信封 + `ParseEnvelope()`（供测试/对齐）。
- `frontend/src/core/i18n/goerr.ts`：`translateGoError` 信封解析版。
- `internal/app/integration.go`：12 处用户可见错误已迁移为 `i18nerr.New(...)`（code 集合见 §五）。
- `locales/zh-CN.ts` + `locales/en.ts`：试点 `goerr.*` key 已加（ja/ko/zh-TW 按 ADR-059 回退 zh-CN，Phase 2 补全）。
- 测试：`internal/i18nerr/errors_test.go`（Go 往返）、`frontend/src/__tests__/goerr.test.ts`（6 用例：zh-CN/en/未知 code 回退/旧式字符串/原始字符串），全绿。

---

## 三、决策对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. Go 返回 error code + 前端 t() 翻译（本 ADR）** | `UserError{Code,Params}` + `goerr.*` bundle 命名空间 | 彻底解决体验断裂；翻译与前端 i18n 体系统一；CI 可守门 | 需改 Go 错误契约 + 绑定层序列化 + 前端 catch 改造 |
| B. Go 端也接 i18n bundle | Go 侧读语言偏好 + 本地 bundle 翻译 | 前端零改动 | Go 侧需维护 bundle（与前端重复）；语言切换需通知 Go；耦合重 |
| C. 维持现状 | Go 错误永远中文 | 零改动 | 非中文用户体验断裂；无法本地化 Go 错误 |

**选 A**：与 ADR-059 的"前端为 i18n 单一入口"原则一致，Go 侧只负责结构化错误，翻译仍归前端 `t()`。`UserError` 的 `fallbackMsg` 保留中文确保 Go 侧日志可读，不依赖前端语言。

---

## 四、风险与边界

| 风险 | 等级 | 缓解 |
|------|------|------|
| 绑定层 `UserError` 序列化未覆盖 | 中 | Phase 1 先验证 Wails v3 对 `error` 接口的自定义序列化行为；若不支持 `MarshalJSON`，回退方案 B（code 前缀） |
| 旧式 `fmt.Errorf` 遗漏未迁移 | 中 | `translateGoError` 对无 code 的错误回退到 `e.message`（显示原始中文），不阻塞；后续逐步迁移 |
| `goerr.*` key 翻译质量 | 中 | 与 ADR-059 同流程，CI 奇偶校验守门；术语遵循 terminology.md |
| Go 侧 `fallbackMsg` 与 bundle 文本漂移 | 低 | `fallbackMsg` 仅日志用，不展示给用户；bundle 是唯一展示源 |

### 边界

- 本 ADR **仅处理用户可见错误**（前端会展示的）。Go 内部错误（`runtime.LogErrorf` 英文日志）不变。
- 本 ADR **不涉及** Go 侧返回的成功消息（如"已启动 MMD"），那些由前端 `t()` 自行生成。
- 本 ADR **不改变** `terminology.md §三` 的"用户错误中文、内部日志英文"原则——`fallbackMsg` 仍是中文，只是前端不再直接展示它。

---

## 五、实施路标

### Phase 1: 契约验证（~1 天）— ✅ 已完成（2026-07-17）

- [x] 新建 `internal/i18nerr/errors.go`（`UserError` 类型 + `New()` + `EnvelopeMarker` + `ParseEnvelope`）
- [x] 验证 Wails v3 绑定层序列化行为 → **`MarshalJSON` 对跨桥无效**（证据链见 §2.6）
- [x] 转向信封方案：`.Error()` 内嵌 `@@GOERR@@` 哨兵 JSON 信封 + 前端 `lastIndexOf` 解析（非原方案 B 的脆弱前缀）
- [x] 新建 `frontend/src/core/i18n/goerr.ts`（`translateGoError`，信封解析版）
- [x] 试点：迁移 `integration.go` **12 处**用户可见错误为 `i18nerr.New(...)`（含 Blender/MMD/config/screenshot）
- [x] 验证：单测证明切到 `en` 后 `software.notFound` 显示英文 `Could not find Blender. Please set its path in Settings.`（见 `goerr.test.ts`）

### Phase 2: 全量迁移（~2 天）

- [ ] 迁移 `internal/app/*.go` 所有用户可见错误为 `i18nerr.New()`
- [ ] `locales/*.ts` 五语言同步新增 `goerr.*` key（约 20 条）
- [ ] 前端所有 `catch(e) { ... e.message ... }` 改为 `translateGoError(e)`
- [ ] `npm run check:i18n` 确认 key 对齐
- [ ] 验证：`npm run check && npm run test && npm run build` 全绿

### Phase 3: 防回归（~0.5 天）

- [ ] Go 侧加 lint：`internal/app/` 内禁止 `fmt.Errorf` 直接返回中文字符串（须用 `i18nerr.New`）
- [ ] 前端加 lint：`catch` 块内禁止直接读 `e.message` 展示给用户（须过 `translateGoError`）

---

## 六、相关 ADR

- [ADR-059](adr-059-i18n-framework.md) — 前端 i18n 框架（本 ADR 是其 Go 侧延伸）
- [ADR-105](adr-105-abort-signal-and-async-error-handling.md) — AbortSignal 与异步错误处理（Go 错误的异步传递规范）
