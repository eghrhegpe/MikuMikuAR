# ADR-156: 大模型交流 — 创意路线（角色台词生成）

- **状态**: 🟡 Step 1 + Step 2a 已实施（台词生成 + 情绪卡片 + TTS 朗读）；Step 2b（口型闭环）待评估（2026-07-28）
- **日期**: 2026-07-20（初版），2026-07-28（Step 1+2a 落地回填）
- **相关**: `novel/`（——实为开发编年史，非角色人设，见下方数据源修正）、ADR-196（AiService 传输层，本路线底座）、ADR-079（感知层 LipSync，口型驱动）、ADR-153（无障碍）

---

## 背景与问题

同 ADR-154。本路线面向创意内容：喂角色人设 / 剧情给 LLM，生成 MMD 角色对白 / 台词，与现有 `novel/` 体系同源。

## 路线对照

| 路线 | 第一步交付 | 后续扩展 | 风险 |
|------|-----------|---------|------|
| 推荐（ADR-154） | 聊天面板（客户端+流式+面板） | 叠 NL 控场景 | 🟢 低 |
| 激进（ADR-155） | 直接 NL 控场景 | — | 🟡 中 |
| **创意（本 ADR）** | 角色台词 | 接 TTS/口型 | 🟡→🔴 |

## 决策

LLM 接收角色圣经（可复用 `novel/` 设定）+ 上下文，输出带情绪标签的对白文本；基础版仅文本，进阶接 TTS → 口型同步（VMD）。

### 第一步交付

| 模块 | 建议落点（规划） | 内容 |
|------|----------------|------|
| 角色圣经结构 | `frontend/src/core/character-bible.ts` | 从 `novel/` 抽取 / 对齐角色设定 |
| 台词生成 | `internal/app/llm/client.go`（复用）+ `dialogue.go` | prompt + 输出格式约束，输出 `{line, emotion}` |
| 字幕面板 | `frontend/src/menus/ai-subtitle.ts` | 展示生成对白 |

### 后续扩展

接 TTS 引擎 + 口型驱动（VMD 情绪 → 口型映射）。此部分 scope 弹性大，是主要风险来源，需单独评审。

## 风险与回退

| 风险 | 等级 | 缓解 |
|------|------|------|
| 人设一致性漂移 | 🟡 | 固定 system prompt + 角色圣经检索 |
| 接 TTS / 口型 scope 膨胀 | 🔴 | 该部分单列评审；基础版先不接；口型驱动依赖现有 VMD 体系，需独立 ADR |
| 输出格式不稳定 | 🟡 | JSON schema 强约束 |

## 实施路径

| 阶段 | 范围 | 验收 |
|------|------|------|
| Step 1 ✅ | 角色圣经 + 台词生成 + 面板（纯文本） | 输入人设产出带情绪标签对白、`tsc --noEmit` 0 错 |
| Step 2a ✅ | 情绪卡片渲染 + SpeechSynthesis 朗读 | 台词卡片化展示 + 可出声（环境不支持时优雅降级） |
| Step 2b 🟡待评估 | 口型闭环（让发声时嘴动） | 见下方§Step 2b 分析，需先选定 A/B 方案 |

---

## 实施记录（2026-07-28）

### 数据源修正：`novel/` 不是角色圣经

初版假设「复用 `novel/` 设定」。实地核实后修正：`novel/` 149 篇是**项目开发编年史**（拟人化讲代码重构的故事，如「01-建材仓库的大扫除」），**不含 Miku 等角色人设 bible**。故 `character-bible.ts` 为内建人设，不从 `novel/` 抽取。

### Step 1 + 2a 落点

| 模块 | 文件 | 说明 |
|------|------|------|
| 角色圣经 | `core/ai/character-bible.ts` | 纯数据 + `buildDialogueSystemPrompt()` + 容错解析 `parseDialogueLines()`（零依赖叶子） |
| 会话状态 | `core/ai/dialogue-session.ts` | 单点持有 activeBibleId，写入点唯一 |
| 语音朗读 | `core/ai/dialogue-speech.ts` | SpeechSynthesis 封装，情绪→语速/音高映射，不支持时静默降级 |
| 面板接入 | `menus/settings-diagnostic.ts` | 第四个 tab「🎭 台词」+ 情绪卡片渲染 + 离开 tab 取消朗读 |
| 情绪样式 | `app.css` | 6 情绪语义色卡片（复用 CSS token） |
| i18n | `core/i18n/locales/*.ts` ×5 | `ai.mode.dialogue` + `ai.dialogue.emotion.*` 六情绪，五语言对齐 |
| 单测 | `core/__tests__/{character-bible,dialogue-speech}.test.ts` | 23 例全绿（含容错解析 + 降级路径） |

---

## §Step 2b：口型闭环分析（待评估，重要决策登记）

### 根因：两条音频管线物理隔离

初版乐观假设「TTS 出声 → LipSync 自动跟」。**磁盘核实后证伪**：

```
SpeechSynthesis.speak()  →  浏览器独立音频输出  →  ❌ 不经 HTMLAudioElement / AudioContext
LipSync 振幅源（perception-lipsync.ts）：
  getProcBeatDetector()  →  AnalyserNode  ←  createMediaElementSource(MMD音乐的 audioElement)
  且受 isAudioPlaying() / getAudioPath() 门控（均为 MMD 音乐播放器状态）
```

两条管线物理隔离：BeatDetector 只采样绑定的那一个 `HTMLAudioElement`（MMD 音乐），TTS 既不经它也不经同一 AudioContext，**因此 SpeechSynthesis 的声无法驱动口型**。此外 LipSync 还被 `isAudioPlaying()`（MMD 音乐是否在播）门控，TTS 播放时该值为 `false`，直接进衰减分支。

### 三条出路

| 方案 | 做法 | 代价 | 风险 | 口型真实度 |
|------|------|------|------|-----------|
| **A. TTS 音频灌入现有 AnalyserNode** | 弃 SpeechSynthesis（拿不到音频流），改**后端 TTS 返回音频 blob** → `new Audio()` →喂 BeatDetector；并解耦 `isAudioPlaying` 门控使其可接临时音源 | 中：改 BeatDetector 支持临时音源 + 门控解耦 + 引入后端 TTS 依赖 | 🟡 | 高（真振幅） |
| **B. 时长估算伪振幅** | 不采样音频，按台词字数估算朗读时长，用**程序化伪振幅**（正弦/噪声）驱动口型 morph，与 SpeechSynthesis 并行 | 低：新增一个「台词口型驱动器」绕开 BeatDetector | 🟢 | 中（视觉「在说话」，非精确同步） |
| **C. 仅保留出声（已采纳）** | Step 2a 到「出声」为止，明确不接口型 | 零 | 🟢 | 无口型 |

### 裁决（2026-07-28）

采纳 **C**：Step 2a 交付的朗读功能本身有独立价值（能出声）；口型闭环基于错误假设，需额外工程（A/B），不塞进 Step 2a。推荐后续选 **B**（时长估算伪振幅）作为最务实的口型方案，单列 Step 2b 认真做；若日后引入后端高质量 TTS（参 ADR-154 已备 Go LLM 客户端模式），再升级为 A。

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-20 | 初版，创意路线定稿 |
| 2026-07-28 | Step 1+2a 落地回填：状态转已实施；修正 novel/ 数据源假设；记录音频管线隔离真相，口型闭环降级为 Step 2b（A/B/C 三条出路 + 裁决 C） |
