/**
 * adr-status-categories.mjs
 * ADR 状态分类词表共享模块 —— 词表单一事实源 + 唯一分类入口 classifyStatus。
 *
 * 使用方：check-adr-status.mjs / check-adr-health.mjs / gen-docs-index.mjs（展示桶）。
 *
 * ## 历史与统一（R3 分叉已消解，2026-08-08）
 * 早期 STATUS_CATEGORIES（健康分类 3 桶 + unknown，任意子串命中）仅供 check 脚本，
 * gen-docs-index 自带 ADR_BUCKETS 展示桶正则（4 桶 + 其他，归档锚定行首/⚠️ 前缀/调研归档三档），
 * 两套词表各自维护，酿成：
 *   - 「已立」漏词：ADR-245~254 在 index 归已落地，check 却只靠 ✅ 碰巧命中 completed；
 *   - check↔index 分叉：adr-019/043/044（check=completed、index=已归档）、adr-133（index=其他）。
 * 现统一为单一入口 classifyStatus()，check 与 index 共用；词表并入 STATUS_CATEGORIES 一处维护。
 * 消解后的归属（真实语料可复现）：
 *   - adr-019「已完成 … ⚠️ **已废弃**」→ 已归档（⚠️ 前缀锚定优先于「已完成」子串）
 *   - adr-043/044「已完成 — 调研归档」→ 已归档（调研归档三档）
 *   - adr-133「⚠️ 决策二证伪」→ 已归档（证伪强语义；index 原=其他）
 *   - adr-149「已登记（搁置待修复…）」→ 已归档（兜底：无完成/推进/规划词且含废弃词）
 *
 * 各脚本禁止各自维护词表 —— 一律 import STATUS_CATEGORIES / classifyStatus。
 * 零依赖。
 */

// ── 词表单一事实源 ─────────────────────────────────────────
// 健康分类视图（3 桶 + unknown），同时是展示桶的词源。补词/删词只改这里。

// 推进中 / 规划中是 inProgress 的下钻细分（展示桶粒度），单一来源；STATUS_CATEGORIES.inProgress 由两者拼接。
const _PROGRESS_WORDS = ['实施中', '进行中', '推进中', '部分实施', '部分实现', '部分落地', '开发中'];
const _PLANNING_WORDS = ['规划', '草案', '提议', 'Proposed', '提案', '计划', '待定', '待实施', '已立项'];

export const STATUS_CATEGORIES = {
  completed: ['已完成', '已实施', '已落地', '已立', '已批准', '已采纳', '已实现', '已交付', '已修复', '完成', '实施完成', '通过', '✅', 'accepted', '已裁决', '已定性', '已收口', '实施完毕', '采纳'],
  inProgress: [..._PROGRESS_WORDS, ..._PLANNING_WORDS],
  deprecated: ['已废弃', '已放弃', '已搁置', '搁置', '废弃', '过时', '已过时', '被取代', '取代', 'superseded', '归档', '调研归档', '调研落档', '归档登记', '证伪', '已退役', '作废', '取消', '已被']
};

// ── 展示桶细分（classifyStatus 内部用；词源见上方 _PROGRESS/_PLANNING） ──
const _RE_PROGRESS = new RegExp(_PROGRESS_WORDS.join('|'));
const _RE_PLANNING = new RegExp(_PLANNING_WORDS.join('|'));
const _RE_COMPLETED = new RegExp(STATUS_CATEGORIES.completed.join('|'));
// 兜底归档：任意位置命中废弃/搁置类词（无完成/推进/规划词时兜底，捕获 ADR-149 式「已登记（搁置…）」）
const _RE_ARCHIVE_FALLBACK = /已废弃|已放弃|已搁置|搁置|废弃|过时|已过时|被取代|取代|superseded|归档|证伪/i;
// 锚定归档三档：① 状态行开头即废弃语义；② ⚠️/🗑️/📋 强调标记后紧跟废弃词（§6 局部过时等限定语不触发）；
// ③ 明确调研落档 / 归档登记；另加「证伪」强语义（ADR-133 决策二证伪）。
const _RE_ARCHIVE = /^(?:已废弃|已过时|已放弃|已搁置|已退役|废弃|放弃|搁置|归档|落档|作废|取消|被取代|已被|superseded)|(?:⚠️|🗑️|📋)\s*\*{0,2}(?:已废弃|已过时|已放弃|已搁置|已退役|被取代|已被)|(?:调研归档|调研落档|归档登记)|证伪/i;

/** 展示桶 → 健康分类 映射（check 脚本用）。 */
export const BUCKET_TO_CATEGORY = {
  已落地: 'completed',
  推进中: 'inProgress',
  规划中: 'inProgress',
  已归档: 'deprecated',
  其他: 'unknown',
};

/** 展示桶展示顺序（gen-docs-index 用）。 */
export const DISPLAY_BUCKET_ORDER = ['推进中', '规划中', '已落地', '已归档', '其他'];

/**
 * 唯一分类入口：返回展示桶 key（已落地 / 推进中 / 规划中 / 已归档 / 其他）。
 * 顺序敏感（与 ADR_BUCKETS 原语义一致）：
 *   已归档（锚定）→ 推进中（部分实施须先于「已实施」匹配）→ 已落地 → 规划中 → 兜底归档 → 其他。
 */
export function classifyStatus(status) {
  if (!status) return '其他';
  if (_RE_ARCHIVE.test(status)) return '已归档';
  if (_RE_PROGRESS.test(status)) return '推进中';
  if (_RE_COMPLETED.test(status)) return '已落地';
  if (_RE_PLANNING.test(status)) return '规划中';
  if (_RE_ARCHIVE_FALLBACK.test(status)) return '已归档';
  return '其他';
}

/**
 * 技术债务关键词 —— check-adr-health / check-adr-technical-debt 共用。
 * 语义:状态行出现这些词表示该 ADR 带技术债/已过时/待推进,需人工关注。
 * 与 STATUS_CATEGORIES 不同:那是「分类」,这是「债务标记」,但同样禁止各脚本
 * 各自维护一份(历史教训:两脚本曾 12 项 vs 16 项分岐)。
 */
export const TECHNICAL_DEBT_KEYWORDS = [
  '已废弃', '已放弃', '已搁置', '搁置', '废弃',
  '待立项', '草案', '提案', 'Proposed',
  '规划中', '部分实现', '待推进',
  '已过时', '已淘汰', '已替换', '已取代'
];
