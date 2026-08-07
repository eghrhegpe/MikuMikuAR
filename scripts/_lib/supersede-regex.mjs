/**
 * supersede-regex.mjs
 * ADR 取代关系判别的核心正则 —— 供 gen-adr-supersede.mjs 与其单测共用。
 *
 * 单测必须 import 本模块的「真身」正则,禁止在测试里复制粘贴,
 * 否则真身改动后测试仍锁旧副本,出现「测试全绿但行为已变」的假绿。
 *
 * 分层语义(与 gen-adr-supersede.mjs 的五层判别对应):
 *   ① RE_SUPERSEDED_BY   状态行声明「被 ADR-NNN 取代/推翻」(已登记)
 *     RE_PARTIAL         局部限定词(部分/§N/条目 N),把①分流为「部分推翻」桶
 *   ② RE_CLAIM_A/B       正文「取代/废弃了 ADR-NNN」紧邻宣称(漏标告警)
 *   ③ RE_SELF_DEPRECATED 状态行自身废弃(⚠️/🗑️ 强调或开头即废弃词)
 *   ④ RE_DEPRECATED_WORD 可疑信号强词(推翻/已过时);RE_NEGATED 否定过滤
 *   ⑤ RE_TABLE_*         表格弱宣称(行首 ADR 编号 + 「本 ADR…替代」跨列)
 *
 * 零依赖(仅 node:fs / node:path)。
 */

// ① 状态行/正文中「被 ADR-NNN 取代」类声明(支持 [ADR-NNN](xxx) 链接写法)——已登记
//    编号与动词之间只允许「markdown 链接目标」这一种有界插入,不再用无界 [^)\]]* 贪婪吞句子,
//    否则「被 ADR-100 影响的部分已由新方案取代」会被误读成「被 ADR-100 取代」。
// [fix 2026-08-06] 兼容粗体包裹整个链接 + 全角括号注记（ADR-012 形态）：
//    「被 **[ADR-113](…)（体积云）** 取代」——粗体 ** 在编号前后都有。
export const RE_SUPERSEDED_BY = /被\s*\*{0,2}\s*\[?ADR-(\d+)\]?(?:\s*\([^)]{0,80}\))?\s*(?:\*{0,2}\s*[（(][^）)]{0,40}[）)]\s*\*{0,2})?\s*(?:取代|替代|推翻|退役)/;

// ①→⑥ 局部限定词:命中则该「被取代」声明只覆盖部分章节/条目,不能整篇计入①
export const RE_PARTIAL = /(部分|局部|§\d|条目\s*\d)/;

// ③ 状态行自身废弃:带 ⚠️/🗑️ 强调标记,或以废弃类词开头(不指明取代者)
//    注意:不能仅因状态行「提到」废弃就判定——ADR-59「废弃 Go UIState 字段」是废弃了别的东西,不是自身废弃
// [fix 2026-08-06] emoji 分支补「整篇/全篇废弃」:ADR-061.1 两篇子编号 ADR 状态
// 「⚠️ **整篇废弃**（XPBD 移除,见 ADR-081）」此前因「整」字拦截未被任何层捕获
export const RE_SELF_DEPRECATED = /(?:⚠️|🗑️)\s*\**(?:(?:已废弃|已过时|已放弃|已搁置|已退役)|(?:整篇|全篇)\s*废弃)|^(?:已废弃|已过时|已放弃|已搁置|已退役|搁置|废弃)/;

// ② 正文「取代/废弃了 ADR-NNN」类宣称,紧邻式(间隔 ≤8 个非字母数字字符),避免宽词误报:
//   A. 宣称方在前:「取代 ADR-019」「替代了 ADR-123」
//   B. 被废弃方在前:「ADR-144 已废弃」「ADR-019(已废弃)」
// 刻意不带 g:全局正则的 lastIndex 有状态,共享单例被 .test() 调用后会让下一次匹配从半截开始跳行。
// 需要一行内抓多个目标时,调用方用 globalOf() 自建带 g 的副本(见下)。
export const RE_CLAIM_A = /(?:取代|替代|推翻|废弃|废除)\s*了?\s*\[?ADR-(\d+)\]?/;
export const RE_CLAIM_B = /ADR-(\d+)\s*[）)]?\s*(?:已\s*(?:废弃|过时|放弃|搁置|退役)|被\s*(?:取代|推翻|替代))/;

/** 由无状态正则派生一个带 g 的副本,供 String.prototype.matchAll 使用(matchAll 强制要求 g)。 */
export function globalOf(re) {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
}

// ④ 可疑信号强词:仅「推翻」与「过时」值得人工确认(决策冲突/文档漂移)
export const RE_DEPRECATED_WORD = /(推翻|已过时)/;
// ④ 否定语境过滤:「非推翻/不推翻/未推翻」等明确否认,不算冲突信号
// [fix 2026-08-06] 扩展覆盖全部宣称词:ADR 常写「本 ADR **不**取代 [ADR-NNN]」澄清边界,
// 原仅防「不推翻」→ 「不取代/不替代/不废弃」被 RE_CLAIM_A 误判为宣称 → 误报漏标。
// [code_review P3] 否定词与动词间容忍 markdown 加粗闭合符（`**不**取代`）：ADR 正文常以
// 加粗强调否定，旧 `\s*` 无法跨越 `**` → RE_NEGATED 不命中，② 漏标误报依旧。
export const RE_NEGATED = /(非|不|未|无|没有)\s*\*{0,2}\s*(?:取代|替代|推翻|废弃|废除|退役)/;

// ② 目标级否定宣称:「不取代/未替代/没有废弃 ADR-NNN」——否定词紧邻宣称动词并带目标编号。
// 与 RE_NEGATED（仅判定「行内存在否定语境」）不同,本正则捕获被否定的具体目标编号,
// 供 gen-adr-supersede ②/④ 做目标级剔除——否则「本 ADR 不取代 ADR-100,同时取代 ADR-200」
// 整行 continue 会吞掉 ADR-200 的真实宣称(② 漏标假绿)。
// [code_review P3] 否定词与动词间同样容忍 markdown 加粗闭合符(`**不**取代 ADR-NNN`)。
export const RE_NEGATED_CLAIM = /(?:非|不|未|无|没有)\s*\*{0,2}\s*(?:取代|替代|推翻|废弃|废除|退役)\s*了?\s*\[?ADR-(\d+)\]?/;

// ⑤ 表格弱宣称:行首列为 ADR-NNN、其他列含「本 ADR…(完全)替代/取代/推翻」(跨列自指)
// 编号含子编号(ADR-061.1),否则 parseFloat 拿到的只是被截断的父编号
export const RE_TABLE_FIRST_COL = /^\|\s*ADR-(\d+(?:\.\d+)?)/;
export const RE_TABLE_VERB = /本\s*ADR[^|]{0,30}(?:完全)?(?:替代|取代|推翻)/;
// ⑤ 否定语境过滤:「不替代/不取代」等明确否认
export const RE_TABLE_NEGATED = /(非|不|未|无|没有)\s*(?:替代|取代|推翻)/;
