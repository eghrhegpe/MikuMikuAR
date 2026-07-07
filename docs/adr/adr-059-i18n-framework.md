# ADR-059: i18n 多语言切换框架

> **状态**: 实施中（Phase 1 已完成 2026-07-07；Phase 2-4 待做）
> **关联**: [ADR-010](adr-010-competitor-ui-mapping.md)（竞品 UI 映射，含 DanceXR 语言项）、[ADR-043](adr-043-dancexr-gap-analysis.md)（DanceXR 差距分析）、[ADR-044](adr-044-competitive-analysis.md)（竞品分析）
> **背景**: 当前全仓 UI 字符串为硬编码中文，约 100 个 `.ts` 文件含中文字面量，分布于 `menus/`、`core/ui-*`、`scene/`、`physics/`。无 i18n 框架、无语言偏好入口。竞品 DanceXR 已支持 5 种语言（简/繁中、英、日、韩）。本 ADR 锁定一套与现有 `core/reactivity` 体系对齐的轻量 i18n 方案。

---

## 一、问题边界

### 1.1 现状清点

| 项 | 事实 | 来源 |
|----|------|------|
| i18n 框架 | 无。`node_modules/y18n` 仅为传递依赖，不可用 | 全仓 grep |
| 字符串分布 | 约 100 个 `.ts` 文件含中文字面量；`menus/*.ts`、`core/ui-*.ts`、`scene/*`、`physics/*` 全量内联 | grep `[\p{Han}]` |
| UI 渲染模型 | 命令式 DOM，SlideMenu `updateControls()` 由 `core/reactivity.ts` 的 `scheduleRefresh()` 驱动重渲染 | `core/reactivity.ts` |
| 偏好持久化 | `UIState`(30+ 字段) 仅 **7 个**落盘到 Go；语言项不在其中 | `core/types.ts:219` |
| 现有先例 | `getMmdRuntimeType/setMmdRuntimeType`(`core/state.ts:33`) 用 `localStorage`+try/catch 存前端偏好 | `state.ts` |
| 设置归口 | `menus/settings-targets.ts` 已集中所有 settings 导航 target | `settings-targets.ts` |

### 1.2 痛点

- **无切换能力**：用户无法切换界面语言。
- **抽取成本高**：字符串散落内联，无中央目录，逐条迁移机械但量大（估算数千条）。
- **动态字符串**：`setStatus(\`已加载 ${n} 个模型\`)` 等模板插值需占位符方案，不能简单 key 查表。
- **排序 collation**：`library-core.ts:432` 用 `localeCompare(b.label, 'zh')` 硬编码中文排序，需随语言切换。

### 1.3 与竞品的关系

| 维度 | DanceXR | 本联邦（目标） |
|------|---------|---------------|
| 语言数 | 5（简/繁中、英、日、韩） | 5（对齐） |
| 切换入口 | 系统菜单 → 语言 | 设置 → 语言（对齐 `settings-targets.ts`） |
| 持久化 | 设置内 | `localStorage`（MVP，零 Go 改动） |

---

## 二、方案设计

### 2.1 核心思路：自研轻量 `core/i18n/`

不引入 i18next 等重库。现有 UI 是**纯命令式 DOM + 自研 reactivity**（`subscribe`/`scheduleRefresh`），已具备「改状态 → 重渲染所有已开菜单」的热切换能力。i18next 的组件级订阅模型与本体系重叠，且其 Bundle 机制对 SPA 命令式渲染是过度设计。

```
core/i18n/
  locale.ts      // currentLang signal + get/set + localStorage 持久化（镜像 setMmdRuntimeType）
  t.ts           // t(key, params?) 翻译函数；缺失回退 zh-CN → key
  locales/
    zh-CN.ts     // 基准 bundle（现有硬编码字符串迁移目标）
    zh-TW.ts
    en.ts
    ja.ts
    ko.ts
```

### 2.2 语言清单（与竞品对齐）

| code | BCP-47 | 说明 | MVP 优先级 |
|------|--------|------|-----------|
| `zh-CN` | `zh-CN` | 简体中文（基准，当前默认） | P0 |
| `en` | `en` | 英语 | P0（试点） |
| `ja` | `ja` | 日语 | P1 |
| `ko` | `ko` | 韩语 | P1 |
| `zh-TW` | `zh-TW` | 繁体中文 | P2 |

### 2.3 热切换机制

```ts
// core/i18n/locale.ts
import { reactive, scheduleRefresh } from '../reactivity';

type LangCode = 'zh-CN' | 'en' | 'ja' | 'ko' | 'zh-TW';

const LANG_KEY = 'uiLang';
const FALLBACK: LangCode = 'zh-CN';

const state = reactive({ lang: loadLang() });

export function getLang(): LangCode { return state.lang; }

// [doc:adr-059] 切换语言 → 持久化 + 触发所有已开菜单重渲染
export function setLang(lang: LangCode): void {
  state.lang = lang;
  saveLang(lang);          // try/catch localStorage，镜像 setMmdRuntimeType
  scheduleRefresh();       // 已开 SlideMenu 的 updateControls() 自动重读 t()
}

function loadLang(): LangCode {
  try {
    const v = localStorage.getItem(LANG_KEY) as LangCode | null;
    return v ?? FALLBACK;
  } catch { return FALLBACK; }
}
function saveLang(l: LangCode): void {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
}
```

**关键**：所有菜单标签在 `updateControls()` 渲染时调用 `t()` 读取，因此 `scheduleRefresh()` 后已开面板标签自动刷新，无需重建菜单树。

### 2.4 `t()` API 与回退

```ts
// core/i18n/t.ts
import { getLang } from './locale';
import { zhCN } from './locales/zh-CN';

type Bundle = Record<string, string>;
const bundles: Record<string, Bundle> = { 'zh-CN': zhCN /*, en, ja, ko, zh-TW */ };

// [doc:adr-059] {name} 占位符替换；缺失回退 zh-CN → key 本身（开发期可见）
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = getLang();
  let s = bundles[lang]?.[key] ?? zhCN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}
```

### 2.5 设置页入口

```ts
// menus/settings-targets.ts —— 新增导航 target
export const SETTINGS = {
  // ... 现有 10 项
  LANGUAGE: 'settings:language',   // [doc:adr-059]
} as const;
```

`menus/settings.ts` 新增「语言」行 → 子菜单列出 5 种语言，radio 选中 `getLang()`；点击调 `setLang(code)`（自动 `scheduleRefresh`）。

### 2.6 字符串抽取约定

| 类型 | 改造前 | 改造后 |
|------|--------|--------|
| 静态标签 | `'模型库'` | `t('menu.library.title')` |
| 动态状态 | `` `已加载 ${n} 个模型` `` | `t('status.modelsLoaded', { n })` |
| emoji | 保留（通用符号，不翻译） | 保留 |
| 排序 | `localeCompare(b.label, 'zh')` | `localeCompare(b.label, getLang())` |

---

## 三、详细实现

### 3.1 首屏时序

在 `main.ts` init 早期（菜单渲染前）调用 `initI18n()`：

```ts
// [doc:adr-059] 菜单渲染前确定语言，避免首帧闪烁
import { getLang } from './core/i18n/locale';
export function initI18n(): void { /* 预读 localStorage 已由 locale.ts 模块加载期完成 */ void getLang(); }
```

locale bundle 为同步导入的 TS 对象（体积小、可 tree-shake），无需异步 fetch，规避首屏时序风险。

### 3.2 抽取分批策略（降低回归风险）

按模块分批，每批 `npm run check && npm run test && npm run build` 验证：

1. **Phase 1（试点）**：`core/i18n/*` + `menus/settings.ts` + `menus/settings-targets.ts` + `menus/library.ts`
2. **Phase 2**：`menus/model-detail.ts`、`menus/scene-*.ts`、`menus/motion-*.ts`
3. **Phase 3**：`core/ui-*.ts`、`core/dialog.ts`、`core/state.ts` 状态消息
4. **Phase 4**：`scene/*`、`physics/*` 中的 `setStatus`/toast

### 3.3 动态字符串统一

全仓 `setStatus(\`...${x}...\`)` 等模板插值，统一改为 `t('status.xxx', { x })`。需建立状态消息 key 命名空间 `status.*`。

### 3.4 排序 collation

`library-core.ts:432` 改为 `localeCompare(b.label, getLang())`，使列表排序随语言 locale 调整。

### 3.5 防回归（可选 Phase）

- 新增 eslint 规则 / grep 检查，禁止在 `menus/`、`core/ui-*`、`scene/`、`physics/` 直接出现中文字面量（i18n 范围内）。
- ADR 落地后，CI（`adr-041`）可加一条「非 `locales/` 文件不得含未包裹中文」的预检。

---

## 四、决策对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 自研轻量 `core/i18n/`（本 ADR）** | signal + `t()` + TS bundle + localStorage | 与 `scheduleRefresh` 体系零摩擦、零依赖、热切换天然 | 需自维护 bundle 与抽取流程 |
| B. i18next | 成熟 i18n 库 | 生态全、plural/ICU 内置 | 与自研 reactivity 重叠；Bundle 体积与 API 对命令式 DOM 过度设计；需适配层 |
| C. Go `UIState` + `SetUILanguage` | 语言进 Go 持久化 | 与设置导入/导出统一、跨设备 | 需改 Go + `wails generate`；与 `MmdRuntimeType` 的 localStorage 先例不一致 |

**选 A 为 MVP**：复用 `setMmdRuntimeType` 的 localStorage 先例，零 Go 改动，最快跑通热切换闭环。

**持久化升级（未来可选）**：若需语言随「设置导入/导出」统一或跨设备同步，再升级为 Go `UIState` + `SetUILanguage` 绑定（届时本 ADR 追加 Phase）。当前 MVP 明确**不**动 Go。

---

## 五、实施路标

### Phase 1: 核心框架 + 试点（~2–3 天）

- [x] 新建 `core/i18n/locale.ts`（`getLang`/`setLang` + localStorage 持久化，镜像 `setMmdRuntimeType`）
- [x] 新建 `core/i18n/t.ts`（`t(key, params?)` + 回退链）
- [x] 新建 `core/i18n/locales/zh-CN.ts` + `en.ts`（基准 bundle + 英语试点；`settings`/`lang` 命名空间）
- [x] `menus/settings-targets.ts` 增 `SETTINGS.LANGUAGE`
- [x] `menus/settings.ts` 增「语言」行（根级 folder）+ 子菜单 radio（`buildSettingsLanguageLevel`，`lang:` target → `setLang`）
- [x] `main.ts` init 期 `initI18n()` 读取语言并同步 `<html lang>`
- [x] 热切换试点：设置根级 9 项 + 语言子菜单均经 `t()` 化，点击语言即 `setLang` → `scheduleRefresh` 热刷新（注：原计划的 `library.ts` 试点改为设置页 pilot——`library.ts` 经核查无用户界面中文字符串，故以设置页为演示载体）
- [x] 验证：`npm run check` ✅ / `npm run test` ✅（1099 passed）/ `npm run build` ✅

### Phase 2: 批量抽取 menus/（~3–4 天）

- [ ] `menus/model-detail.ts`、`menus/scene-*.ts`、`menus/motion-*.ts` 全量 `t()` 化
- [ ] 补全 `locales/zh-CN.ts`；启动 `en.ts` 试点翻译

### Phase 3: core/scene/physics 抽取（~2–3 天）

- [ ] `core/ui-*.ts`、`core/dialog.ts`、`core/state.ts` 状态消息
- [ ] `scene/*`、`physics/*` 中 `setStatus`/toast 改为 `t('status.*', params)`
- [ ] `library-core.ts:432` collation 随语言切换

### Phase 4: 多语言补全 + 防回归（按需）

- [ ] `locales/ja.ts`、`ko.ts`、`zh-TW.ts`（翻译内容工作量，独立于架构）
- [ ] 可选：eslint/grep 防回归规则接入 CI

---

## 六、风险与边界

| 风险 | 等级 | 缓解 |
|------|------|------|
| 字符串抽取量大、易漏易错 | 高 | 分批 + 每批 check/test/build；可选防回归 grep 规则 |
| 动态字符串占位符约定不一致 | 中 | 统一 `{name}` 语法；`t()` 强制 params 类型 |
| 首屏闪烁（语言未定先渲染） | 低 | locale 模块加载期即读 localStorage，菜单渲染前已定 |
| 已开菜单未重渲染 | 低 | 所有标签在 `updateControls()` 内调 `t()`，由 `scheduleRefresh()` 触发 |
| 持久化与设置导入/导出不统一 | 低 | MVP 接受（同 `MmdRuntimeType` 先例）；未来可升 Go |
| 翻译内容质量（en/ja/ko） | 中 | 独立工作量，可由用户或 AI 提供；架构不阻塞 |

### 边界

- 本 ADR **不引入** i18next 等第三方 i18n 库。
- 本 ADR **MVP 阶段不修改** Go 后端；持久化用 `localStorage`。
- 本 ADR **不涉及** 模型内文件名 / 资源路径编码（属 ADR-057/058 范畴）。
- 本 ADR **不处理** 运行时动态加载的第三方内容文本（如 PMX 内部字符串）。
- 多 AI 协作：实施阶段若触碰 `settings.ts` / `types.ts` / `config` 默认值 / `core/orbit.ts`，须先在当日 `memory/YYYY-MM-DD.md` 认领（见项目铁律）。

---

## 七、验证方式

1. **热切换**：打开任意菜单 → 设置 → 语言 → 切到 `en` → 已开菜单标签即时变为英文；刷新应用后仍为 `en`（localStorage 持久化）。
2. **回退**：切到尚未翻译完整的语言，缺失 key 显示 `zh-CN` 文本而非空白。
3. **动态字符串**：加载多个模型，状态栏 `已加载 N 个模型` 在切换语言后正确本地化且 `N` 正确插值。
4. **排序**：语言切到 `en` 后，模型库列表按英语 locale 排序。
5. **回归**：`npm run check && npm run test && npm run build` 全绿。

---

## 八、相关 ADR

- [ADR-010](adr-010-competitor-ui-mapping.md) — 竞品 UI 映射（含 DanceXR 语言项）
- [ADR-043](adr-043-dancexr-gap-analysis.md) — DanceXR 差距分析
- [ADR-044](adr-044-competitive-analysis.md) — 竞品分析
- [ADR-041](adr-041-ci-auto-checks.md) — CI 自动检查（防回归规则可挂此）
- [ADR-054](adr-054-roadmap-next.md) — 路线图（i18n 可作为后续能力项登记）
