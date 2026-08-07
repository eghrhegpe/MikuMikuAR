/**
 * adr-status-categories.mjs
 * ADR 状态分类词表共享模块 —— 供 check-adr-status.mjs / check-adr-health.mjs 共用。
 *
 * 词表语义与 gen-docs-index.mjs 的 ADR_BUCKETS 桶对齐
 * (已落地 / 推进中 / 规划中 / 已归档)。注意:
 * - completed 在前,「已完成…局部搁置/过时」(ADR-168/162 等)先命中 completed,不误报废弃
 * - 「部分实现」是推进中语义,不能放 deprecated
 * - 归档语义词覆盖:过时/被取代/superseded/归档登记/调研落档/决策证伪
 *
 * 各脚本禁止各自维护一份词表 —— 否则同一批 ADR 分类结论会分岐
 * (历史教训:check-adr-health 曾报 207/7/3/8,check-adr-status 报 206/11/8/0)。
 *
 * ## 与 gen-docs-index.mjs ADR_BUCKETS 的已知分歧（R3 2026-08-08 登记）
 * 本模块是「健康分类」词表（3 桶 + unknown，任意子串命中），ADR_BUCKETS 是
 * gen-docs-index 的「展示桶」（4 桶 + 其他，归档类锚定行首/⚠️ 前缀/调研归档三档）——
 * 两者目的不同，未强行收敛为单一函数，已知分歧如下（真实语料可复现）：
 *   - adr-019「已完成…⚠️ 已废弃」：本表=completed（'已完成'先命中）、index=已归档
 *   - adr-043/044「已完成 — 调研归档」：本表=completed、index=已归档
 *   - adr-133「⚠️ 决策二证伪」：本表=deprecated（'证伪'在 deprecated 词表）、
 *     index=其他（ADR_BUCKETS 无'证伪'）——如要让 index 也归归档，需在 ADR_BUCKETS 加词
 * 若后续需要「check 与 index 分类完全一致」，应把两套词表统一为共享归一化函数；
 * 在此之前各脚本不得自行增删本表词条（避免分歧进一步漂移）。
 *
 * 零依赖。
 */

export const STATUS_CATEGORIES = {
  completed: ['已完成', '已实施', '已落地', '已批准', '已采纳', '已实现', '已交付', '已修复', '完成', '实施完成', '通过', '✅', 'accepted'],
  inProgress: ['实施中', '进行中', '推进中', '规划', '草案', '提议', 'Proposed', '部分落地', '部分实现', '已立项'],
  deprecated: ['已废弃', '已放弃', '已搁置', '搁置', '废弃', '过时', '已过时', '被取代', '取代', 'superseded', '归档', '调研归档', '调研落档', '归档登记', '证伪']
};

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
