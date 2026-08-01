---
tier: leaf
kind: character_dialogue
name: 角色台词生成 — 人设约束 + 情绪解析 + TTS 朗读
category: core
scope:
  - frontend/src/core/ai/character-bible.ts
  - frontend/src/core/ai/dialogue-session.ts
  - frontend/src/core/ai/dialogue-speech.ts
source_files:
  - frontend/src/core/ai/character-bible.ts
  - frontend/src/core/ai/dialogue-session.ts
  - frontend/src/core/ai/dialogue-speech.ts
adr:
  - ADR-156
  - ADR-196
  - ADR-079
symbols:
  - BUILTIN_BIBLES
  - CharacterBible
  - DIALOGUE_EMOTIONS
  - DialogueEmotion
  - DialogueLine
  - SpeakLine
  - buildDialogueSystemPrompt
  - cancelSpeech
  - getActiveBible
  - getBible
  - isSpeechSupported
  - listBibles
  - parseDialogueLines
  - setActiveBible
  - speakLines
invariants:
  - character-bible.ts 为纯数据+纯函数叶子，零副作用、零应用层依赖；人设内建，不从 novel/ 抽取（novel/ 是开发编年史非角色人设）
  - parseDialogueLines 容错：非法情绪归一到 neutral，解析失败时整段文本兜底为单条 neutral，保证 UI 永远有内容
  - dialogue-session 的 _activeBibleId 为唯一模块级状态，唯一写入点 setActiveBible，非法 id 经 getBible 兜底到首个内置角色
  - SpeechSynthesis 走浏览器独立音频输出，不经 AudioContext，无法被 LipSync BeatDetector 采样，TTS 口型闭环需独立方案（ADR-156 Step 2b）
  - speakLines 先 cancel 既有队列避免叠加重播；环境不支持时静默 no-op
tests: []
use_when:
  - 角色台词
  - 大模型交流
  - 人设
  - 角色圣经
  - 情绪标签
  - 台词朗读
  - TTS 语音合成
  - dialogue
---

## 系统概览
ADR-156 创意路线的台词生成子系统（Step 1 + Step 2a 已落地）。以内建「角色圣经」约束 LLM 用固定人设产出带情绪标签的结构化对白，解析后可用浏览器原生 `SpeechSynthesis` 朗读。台词模式挂在 `settings-diagnostic.ts` 的 `dialogue` tab，底座为 ADR-196 的 AiService 传输层。

## 核心职责
- `character-bible.ts` — 人设数据（`BUILTIN_BIBLES`：miku/narrator）+ `buildDialogueSystemPrompt()`（组装 system prompt，要求 JSON `[{line, emotion}]` 输出）+ `parseDialogueLines()`（容错解析）+ `DIALOGUE_EMOTIONS` 情绪闭集
- `dialogue-session.ts` — 薄状态封装：单点持有 `_activeBibleId`，转发 prompt 构建；`getActiveBible` / `setActiveBible` / `listBibles`
- `dialogue-speech.ts` — Web Speech API 封装：`speakLines()`（按情绪调 rate/pitch 串联朗读）/ `cancelSpeech()` / `isSpeechSupported()`

## 对外 API（节选）
- `getBible(id)` / `getActiveBible()` / `setActiveBible(id)` / `listBibles()`
- `buildDialogueSystemPrompt(bible)` — 人设 + 结构化输出契约
- `parseDialogueLines(raw)` — LLM 文本 → `DialogueLine[]`
- `speakLines(lines, lang?)` / `cancelSpeech()` / `isSpeechSupported()`

## 与其他子系统关系
- 上行：`menus/settings-diagnostic.ts` 的 dialogue tab 取 `getActiveBible()` 组 prompt、调 `parseDialogueLines`、`speakLines`
- 下行：经 `ai-service`（ADR-196）发起 LLM 请求；朗读走浏览器 SpeechSynthesis
- 口型：Step 2b 待评估，需与 ADR-079 感知层 LipSync 独立对接（当前 TTS 不驱动口型）

## 不变量
- 见 frontmatter `invariants`

## 验证入口
- 决策见 ADR-156；暂无专门单测（纯函数 `parseDialogueLines` 为后续补测优先项）
