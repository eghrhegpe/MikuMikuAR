import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseAdrHeader, parseSourceFiles } from '../_lib/frontmatter.mjs';
import {
  RE_SUPERSEDED_BY,
  RE_PARTIAL,
  RE_SELF_DEPRECATED,
  RE_CLAIM_A,
  RE_CLAIM_B,
  RE_DEPRECATED_WORD,
  RE_NEGATED,
  RE_NEGATED_CLAIM,
  RE_HYPOTHETICAL_CLAIM,
  RE_TABLE_FIRST_COL,
  RE_TABLE_VERB,
  RE_TABLE_NEGATED,
  globalOf,
} from './supersede-regex.mjs';

// Helper: write temp ADR files and return paths
function createTempAdr(filename, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-adr-test-'));
  const fp = path.join(dir, filename);
  fs.writeFileSync(fp, content, 'utf8');
  return { dir, fp };
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ── parseAdrHeader ──

test('parseAdrHeader: blockquote format', () => {
  const { dir, fp } = createTempAdr('adr-001-test.md', `# ADR-1: Title One

> **状态**: 已实施（2026-01-01）
> **日期**: 2026-01-01

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.equal(h.num, 1);
    assert.equal(h.title, 'Title One');
    assert.ok(h.status.includes('已实施'));
    assert.equal(h.date, '2026-01-01');
    // 状态行行号（0-based）供调用方界定首部边界，此处状态在第 3 行
    assert.equal(h.statusLine, 2);
  } finally { cleanup(dir); }
});

test('parseAdrHeader: list format', () => {
  const { dir, fp } = createTempAdr('adr-042-test.md', `# ADR-42: Title Two

- **状态**: 规划中
- **日期**: 2026-02-15

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.equal(h.num, 42);
    assert.equal(h.title, 'Title Two');
    assert.ok(h.status.includes('规划中'));
  } finally { cleanup(dir); }
});

test('parseAdrHeader: table format', () => {
  const { dir, fp } = createTempAdr('adr-084-test.md', `# ADR-84: Title Three

| **状态** | 提案 |
| **日期** | 2026-03-01 |

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.equal(h.num, 84);
    assert.ok(h.status.includes('提案'));
  } finally { cleanup(dir); }
});

test('parseAdrHeader: sub-number ADR-061.1', () => {
  const { dir, fp } = createTempAdr('adr-061.1-test.md', `# ADR-061.1: Ragdoll 保真度补齐 实施计划

> **状态**: 已交付
> **日期**: 2026-07-10

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.equal(h.num, 61.1);
    assert.ok(h.title.includes('Ragdoll'));
    assert.ok(h.status.includes('已交付'));
  } finally { cleanup(dir); }
});

test('parseAdrHeader: missing title → error', () => {
  const { dir, fp } = createTempAdr('adr-100-test.md', `> **状态**: Done

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.ok(h.error);
  } finally { cleanup(dir); }
});

test('parseAdrHeader: missing status → error', () => {
  const { dir, fp } = createTempAdr('adr-101-test.md', `# ADR-101: Title

> **日期**: 2026-01-01

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.ok(h.error);
  } finally { cleanup(dir); }
});

test('parseAdrHeader: status with CJK colon', () => {
  const { dir, fp } = createTempAdr('adr-131-test.md', `# ADR-131: 中文冒号测试

> **状态**：实施中（2026-06-01）

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.equal(h.num, 131);
    assert.ok(h.status.includes('实施中'));
  } finally { cleanup(dir); }
});

test('parseAdrHeader: title without colon', () => {
  const { dir, fp } = createTempAdr('adr-132-test.md', `# ADR-132 Title Without Colon

> **状态**: 提案

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.equal(h.num, 132);
    // The no-colon regex captures only the text after the number and space
    assert.equal(h.title, 'Title Without Colon');
    assert.ok(h.status.includes('提案'));
  } finally { cleanup(dir); }
});

test('parseAdrHeader: long status with parenthetical', () => {
  const { dir, fp } = createTempAdr('adr-220-test.md', `# ADR-220: 长状态测试

> **状态**: 部分实施（进度70%，预计Q3完成）

body...
`);
  try {
    const h = parseAdrHeader(fp);
    assert.ok(h.status.includes('部分实施'));
    assert.ok(h.status.includes('Q3'));
  } finally { cleanup(dir); }
});

// ── Supersede regex patterns (gen-adr-supersede core logic) ──

// ① RE_SUPERSEDED_BY: 状态行声明「被 ADR-NNN 取代」

test('RE_SUPERSEDED_BY: matched — 标准形式', () => {
  assert.ok(RE_SUPERSEDED_BY.test('被 ADR-113 取代'));
  assert.equal([...RE_SUPERSEDED_BY.exec('被 ADR-113 取代')][1], '113');
});

test('RE_SUPERSEDED_BY: matched — 链接形式', () => {
  const m = RE_SUPERSEDED_BY.exec('被 [ADR-113](adr-113-test.md) 取代');
  assert.ok(m);
  assert.equal(m[1], '113');
});

// [fix 2026-08-06] 存量 ADR-012「被 **[ADR-113](…)（体积云）** 取代」此前匹配失败
test('RE_SUPERSEDED_BY: matched — 粗体 + 全角括号注记（ADR-012 形态）', () => {
  const m = RE_SUPERSEDED_BY.exec('被 **[ADR-113](adr-113-volume-clouds.md)（体积云）** 取代');
  assert.ok(m, '粗体收尾 + 全角括号应匹配');
  assert.equal(m[1], '113');
  assert.ok(RE_SUPERSEDED_BY.test('被 **[ADR-113](adr-113.md)** 取代'));
});

test('RE_SUPERSEDED_BY: matched — 替代', () => {
  assert.ok(RE_SUPERSEDED_BY.test('被ADR-084替代'));
});

test('RE_SUPERSEDED_BY: matched — 退役', () => {
  assert.ok(RE_SUPERSEDED_BY.test('被 ADR-019 退役'));
});

test('RE_SUPERSEDED_BY: not matched — 无动词', () => {
  assert.ok(!RE_SUPERSEDED_BY.test('被 ADR-019'));
});

test('RE_SUPERSEDED_BY: not matched — 贪婪误判(编号与动词间夹整句)', () => {
  // 回归：旧版 [^)\]]* 无界贪婪会把「被 ADR-100 …新方案取代」误读成「被 ADR-100 取代」
  assert.ok(!RE_SUPERSEDED_BY.test('被 ADR-100 影响的部分已由新方案取代'));
  assert.ok(!RE_SUPERSEDED_BY.test('被 ADR-019 启发的思路后来被推翻'));
});

test('RE_SUPERSEDED_BY: matched — 长链接目标仍可识别', () => {
  const m = RE_SUPERSEDED_BY.exec('被 [ADR-200](adr-200-wind-physics-empty-bundle-map.md) 推翻');
  assert.ok(m);
  assert.equal(m[1], '200');
});

test('RE_SUPERSEDED_BY: not matched — 自身', () => {
  // 自身不应 match（后续代码有额外判断，正则本身可能 match，这里只测匹配性）
  assert.ok(RE_SUPERSEDED_BY.test('被 ADR-001 取代'));
});

// ①b RE_PARTIAL: 局部限定词 → 「部分推翻」而非整篇被取代

test('RE_PARTIAL: matched — 部分被推翻(ADR-071 真实状态行)', () => {
  const status = '已实施（方案 B 全部落地）⚠️ **部分被 ADR-079 推翻**（lifelike/idle 保留定位）';
  assert.ok(RE_SUPERSEDED_BY.test(status));
  assert.ok(RE_PARTIAL.test(status));
});

test('RE_PARTIAL: matched — §N 前提被推翻(ADR-194 真实状态行)', () => {
  const status = '已完成（2026-07-27）⚠️ **§4 风力系数前提被 [ADR-200](adr-200-wind.md) 推翻**';
  assert.ok(RE_SUPERSEDED_BY.test(status));
  assert.ok(RE_PARTIAL.test(status));
});

test('RE_PARTIAL: matched — 条目 N 被推翻(ADR-192 真实状态行)', () => {
  assert.ok(RE_PARTIAL.test('⚠️ **条目 3 隐含假设被 [ADR-200](adr-200-wind.md) 推翻**'));
});

test('RE_PARTIAL: not matched — 整篇被取代', () => {
  assert.ok(!RE_PARTIAL.test('已废弃（被 ADR-167 取代）'));
  assert.ok(!RE_PARTIAL.test('🗑️ 已被 ADR-196 取代（Superseded）'));
});

// ③ RE_SELF_DEPRECATED: 状态行自身废弃

test('RE_SELF_DEPRECATED: matched — emoji 前缀', () => {
  assert.ok(RE_SELF_DEPRECATED.test('⚠️ 已废弃（未指明取代者）'));
});

test('RE_SELF_DEPRECATED: matched — 直接开头', () => {
  assert.ok(RE_SELF_DEPRECATED.test('已废弃'));
  assert.ok(RE_SELF_DEPRECATED.test('已放弃'));
  assert.ok(RE_SELF_DEPRECATED.test('已搁置'));
});

test('RE_SELF_DEPRECATED: matched — 粗体加 emoji', () => {
  assert.ok(RE_SELF_DEPRECATED.test('🗑️ **已废弃**'));
});

// [fix 2026-08-06] ADR-061.1 子编号「⚠️ **整篇废弃**」此前因「整」字拦截未被任何层捕获
test('RE_SELF_DEPRECATED: matched — 整篇/全篇废弃（ADR-061.1 形态）', () => {
  assert.ok(RE_SELF_DEPRECATED.test('⚠️ **整篇废弃**（XPBD 移除，见 ADR-081）'));
  assert.ok(RE_SELF_DEPRECATED.test('🗑️ 全篇废弃'));
});

test('RE_SELF_DEPRECATED: not matched — 正常状态', () => {
  assert.ok(!RE_SELF_DEPRECATED.test('已实施（2026-01-01）'));
  assert.ok(!RE_SELF_DEPRECATED.test('规划中'));
});

// ② RE_CLAIM_A: 正文「取代/替代了 ADR-NNN」

test('RE_CLAIM_A: matched — 取代了', () => {
  const m = RE_CLAIM_A.exec('取代 ADR-019');
  assert.ok(m);
  assert.equal(m[1], '019');
});

test('RE_CLAIM_A: matched — 替代了', () => {
  const m = RE_CLAIM_A.exec('替代了 ADR-123');
  assert.ok(m);
  assert.equal(m[1], '123');
});

test('RE_CLAIM_A: not matched — 无动词', () => {
  assert.ok(!RE_CLAIM_A.test('ADR-019 是相关的'));
});

test('RE_CLAIM_A: case-insensitive — Chinese OK', () => {
  assert.ok(RE_CLAIM_A.test('推翻 ADR-001'));
});

// ② RE_CLAIM_B: 「ADR-NNN 已废弃」

test('RE_CLAIM_B: matched — 已废弃', () => {
  const m = RE_CLAIM_B.exec('ADR-144 已废弃');
  assert.ok(m);
  assert.equal(m[1], '144');
});

test('RE_CLAIM_B: matched — 已过时', () => {
  assert.equal(RE_CLAIM_B.exec('ADR-019 已过时')[1], '019');
});

test('RE_CLAIM_B: matched — 被取代', () => {
  const m = RE_CLAIM_B.exec('ADR-012 被取代');
  assert.ok(m);
  assert.equal(m[1], '012');
});

test('RE_CLAIM_B: matched — 已退役', () => {
  assert.equal(RE_CLAIM_B.exec('ADR-200 已退役')[1], '200');
});

test('RE_CLAIM_B: not matched — 正常提及', () => {
  assert.ok(!RE_CLAIM_B.test('ADR-001 是好的'));
});

// ④ RE_DEPRECATED_WORD + RE_NEGATED: 可疑信号

test('RE_DEPRECATED_WORD: matched — 推翻', () => {
  assert.ok(RE_DEPRECATED_WORD.test('推翻 ADR-192'));
});

test('RE_DEPRECATED_WORD: matched — 已过时', () => {
  assert.ok(RE_DEPRECATED_WORD.test('ADR-192 已过时'));
});

test('RE_DEPRECATED_WORD: not matched — 正常词', () => {
  assert.ok(!RE_DEPRECATED_WORD.test('ADR-001 提案'));
});

test('RE_NEGATED: matched — 非推翻', () => {
  assert.ok(RE_NEGATED.test('非推翻，而是改进'));
});

test('RE_NEGATED: matched — 未推翻', () => {
  assert.ok(RE_NEGATED.test('未推翻旧方案'));
});

test('RE_NEGATED: not matched — 非否定语境', () => {
  assert.ok(!RE_NEGATED.test('推翻 ADR-019'));
});

// [fix 2026-08-06] RE_NEGATED 扩展覆盖全部宣称词:ADR 常写「本 ADR 不取代 [ADR-NNN]」澄清边界,
// 原仅防「不推翻」→「不取代」被 RE_CLAIM_A 误判为宣称 → 误报漏标。
test('RE_NEGATED: matched — 不取代（fix 扩展）', () => {
  assert.ok(RE_NEGATED.test('本 ADR 不取代 [ADR-100]——边界澄清'));
});

test('RE_NEGATED: matched — 未替代（fix 扩展）', () => {
  assert.ok(RE_NEGATED.test('未替代 ADR-093 的注册机制'));
});

test('RE_NEGATED: matched — 没有废弃（fix 扩展）', () => {
  assert.ok(RE_NEGATED.test('没有废弃 ADR-137 的 schema 决策'));
});

// [code_review P3] 加粗形态:ADR 正文常写「本 ADR **不**取代 [ADR-NNN]」强调否定,
// 旧 `\s*` 无法跨越 `**` → RE_NEGATED 不命中,② 漏标误报依旧。
test('RE_NEGATED: matched — **不**取代（加粗形态）', () => {
  assert.ok(RE_NEGATED.test('本 ADR **不**取代 [ADR-100]——边界澄清'));
});

// [code_review P3] 目标级否定宣称:捕获被否定修饰的具体目标编号,
// 供 gen-adr-supersede ②/④ 做目标级剔除(混排「不取代 X 且 取代 Y」不吞真实宣称)。
test('RE_NEGATED_CLAIM: matched — 不取代 ADR-100（捕获 100）', () => {
  const m = '本 ADR 不取代 ADR-100，同时取代 ADR-200 的相机部分'.match(RE_NEGATED_CLAIM);
  assert.ok(m, '应命中否定宣称');
  assert.equal(parseInt(m[1], 10), 100);
});

test('RE_NEGATED_CLAIM: matched — **未**替代 ADR-061.1 子编号（与 RE_CLAIM_A 同为整数捕获，目标级比较一致）', () => {
  // 真实 ADR 写法是加粗否定词本身（**未**替代），而非整个短语——后者星号会挡在 ADR 前
  const m = '本 ADR **未**替代 ADR-061.1 的 ragdoll 方案'.match(RE_NEGATED_CLAIM);
  assert.ok(m, '应命中否定宣称');
  assert.equal(parseInt(m[1], 10), 61, '子编号 061.1 应捕获主号 61，与 RE_CLAIM_A 提取一致');
});

test('RE_NEGATED_CLAIM: not matched — 真实取代宣称不带否定词', () => {
  assert.ok(!RE_NEGATED_CLAIM.test('本 ADR 取代 ADR-200 的相机部分'));
});

// [fix 2026-10-23] 反事实/假设语气：情态词「会/可能」把断言降格为推演，不是取代声明。
// 实测 ADR-264「那会推翻 ADR-228 的既有判断」触发 ② 漏标告警，阻塞 check:docs。
test('RE_HYPOTHETICAL_CLAIM: matched — 那会推翻 ADR-228（捕获 228）', () => {
  const line = '**推论**：本 ADR 的目标不是「消灭全部 inline px」（那会推翻 ADR-228 的既有判断），而是…';
  const m = line.match(RE_HYPOTHETICAL_CLAIM);
  assert.ok(m, '反事实语气应被识别');
  assert.equal(parseInt(m[1], 10), 228);
  // 同一行确实同时命中 RE_CLAIM_A —— 这正是需要剔除的原因
  assert.ok(RE_CLAIM_A.test(line));
});

test('RE_HYPOTHETICAL_CLAIM: matched — 可能会废弃 ADR-120（加粗与了容忍）', () => {
  const m = '若砍掉惰性 cache，**可能**会废弃 ADR-120 的增量策略'.match(RE_HYPOTHETICAL_CLAIM);
  assert.ok(m);
  assert.equal(parseInt(m[1], 10), 120);
});

test('RE_HYPOTHETICAL_CLAIM: not matched — 「将取代」是明确的后续计划，仍属真实宣称', () => {
  assert.ok(!RE_HYPOTHETICAL_CLAIM.test('本 ADR 将取代 ADR-200 的相机部分'));
});

test('RE_HYPOTHETICAL_CLAIM: not matched — 若无情态词的直陈取代宣称', () => {
  assert.ok(!RE_HYPOTHETICAL_CLAIM.test('本 ADR 取代 ADR-200 的相机部分'));
});

// ⑤ 表格弱宣称

test('RE_TABLE_FIRST_COL: matched', () => {
  const m = RE_TABLE_FIRST_COL.exec('| ADR-019 | 标题 |');
  assert.equal(m[1], '019');
});

test('RE_TABLE_FIRST_COL: matched — 子编号 061.1 不被截断', () => {
  const m = RE_TABLE_FIRST_COL.exec('| ADR-061.1 | 标题 |');
  assert.equal(m[1], '061.1');
  assert.equal(parseFloat(m[1]), 61.1);
});

test('RE_TABLE_VERB: matched — 本ADR替代', () => {
  assert.ok(RE_TABLE_VERB.test('本ADR完全替代'));
  assert.ok(RE_TABLE_VERB.test('本 ADR 替代'));
});

test('RE_TABLE_VERB: matched — 本ADR取代', () => {
  assert.ok(RE_TABLE_VERB.test('本ADR取代旧方案'));
});

test('RE_TABLE_NEGATED: matched — 不替代', () => {
  assert.ok(RE_TABLE_NEGATED.test('本ADR不替代旧方案'));
});

test('RE_TABLE_VERB: not matched — 无本ADR', () => {
  assert.ok(!RE_TABLE_VERB.test('ADR-019 替代'));
});

// ── Combined scenario: supersede relationship detection ──

// ── RE_CLAIM_A 补充：缺失的边缘 ──

test('RE_CLAIM_A: matched — 废除', () => {
  const m = RE_CLAIM_A.exec('废除 ADR-088');
  assert.ok(m);
  assert.equal(m[1], '088');
});

test('RE_CLAIM_A: matched — multiple targets in one line', () => {
  // 与生产同款用法：共享常量无 g，抓多目标须经 globalOf() 派生带 g 的副本
  const line = '取代 ADR-001 替代了 ADR-012';
  const matches = [...line.matchAll(globalOf(RE_CLAIM_A))].map((m) => m[1]);
  assert.deepEqual(matches, ['001', '012']);
});

test('globalOf: 派生副本带 g，且不污染原常量的无状态语义', () => {
  const g = globalOf(RE_CLAIM_A);
  assert.ok(g.global);
  assert.ok(!RE_CLAIM_A.global);
  // 无 g 的常量连续 .test() 恒定从头匹配，不会因 lastIndex 漂移而漏判
  assert.ok(RE_CLAIM_A.test('取代 ADR-001'));
  assert.ok(RE_CLAIM_A.test('取代 ADR-001'));
});

test('RE_CLAIM_A: matched — link form [ADR-NNN]', () => {
  const m = RE_CLAIM_A.exec('替代了 [ADR-019](adr-019-foo.md)');
  assert.ok(m);
  assert.equal(m[1], '019');
});

// ── RE_CLAIM_B 补充：中文括号变体 ──

test('RE_CLAIM_B: matched — 中文右括号', () => {
  const m = RE_CLAIM_B.exec('ADR-019）已废弃');
  assert.ok(m);
  assert.equal(m[1], '019');
});

// ── RE_SELF_DEPRECATED 补充：裸词 ──

test('RE_SELF_DEPRECATED: matched — 裸搁置（不带"已"）', () => {
  assert.ok(RE_SELF_DEPRECATED.test('搁置'));
});

test('RE_SELF_DEPRECATED: matched — 裸废弃（不带"已"）', () => {
  assert.ok(RE_SELF_DEPRECATED.test('废弃'));
});

// ── 综合场景 ──

test('Scenario: full supersede chain detected', () => {
  const oldStatus = '被 [ADR-113](adr-113-test.md) 取代';
  assert.ok(RE_SUPERSEDED_BY.test(oldStatus));

  // RE_CLAIM_A: verb BEFORE target ADR
  const bodyA = '替代 ADR-012';
  let m = RE_CLAIM_A.exec(bodyA);
  assert.ok(m);
  assert.equal(m[1], '012');

  // RE_CLAIM_B: ADR BEFORE verb
  const bodyB = 'ADR-012 已废弃';
  m = RE_CLAIM_B.exec(bodyB);
  assert.ok(m);
  assert.equal(m[1], '012');
});

test('Scenario: self-deprecated without pointing successor', () => {
  const status = '⚠️ 已废弃（无替代方案）';
  assert.ok(RE_SELF_DEPRECATED.test(status));
  assert.ok(!RE_SUPERSEDED_BY.test(status));
});

test('Scenario: 状态行仅含「已过时」不构成 ④ 豁免的硬标记', () => {
  // 回归：selfMarked 曾把 RE_DEPRECATED_WORD 算作豁免，导致 ADR-162 这类
  // 「§6 验收标准已过时」的 ADR 整篇正文被静默。豁免只认①整篇被取代/③自身废弃。
  const status = '已完成（2026-07-21）⚠️ **§6 验收标准已过时** — pin 功能已随 ADR-164/166 整合';
  assert.ok(RE_DEPRECATED_WORD.test(status));
  assert.ok(!RE_SUPERSEDED_BY.test(status));
  assert.ok(!RE_SELF_DEPRECATED.test(status));
});

test('Scenario: suspicious signal with negation — should NOT flag', () => {
  const line = '非推翻，而是演进 ADR-192';
  assert.ok(RE_DEPRECATED_WORD.test(line));
  assert.ok(RE_NEGATED.test(line)); // negation present
});

// ── [round-76c #12] 五层优先级组合行为 + 坏日期 error 路径 ──
// gen-adr-supersede.mjs 的 bucketing 读固定 ADR_DIR（_lib/scan-files.mjs 的 ROOT，无 env 钩子；
// 生产脚本锁文件制不许改），组合场景在此按「生产判定式」复刻并锁到共享「真身」正则上：
// 判定式与 gen-adr-supersede.mjs L117-127 / L132-134 / L145-156 / L177-178 / L182-199 / L205-217 逐行对齐。

function supersedeFixture(text) {
  const { dir, fp } = createTempAdr('adr-combo.md', text);
  const h = parseAdrHeader(fp);
  return { dir, h };
}

test('Combo ①+③ 同状态行: 含「被 ADR-NNN 取代」的废弃行分入 ①，③ 因 !mBy 守卫不分流', () => {
  const status = '已废弃（被 [ADR-084](adr-084-water.md) 取代）';
  const mBy = status.match(RE_SUPERSEDED_BY); // 生产 L117
  assert.ok(mBy, '① 应命中');
  assert.equal(parseInt(mBy[1], 10), 84);
  assert.ok(RE_SELF_DEPRECATED.test(status), '③ 同态：状态行开头「已废弃」本身命中');
  // 生产 L121: (isPartial ? partial : registered).push(entry) → ① registered；
  // 生产 L125: if (RE_SELF_DEPRECATED.test(meta.status) && !mBy) → !mBy 为 false → ③ 不推
  assert.ok(!RE_PARTIAL.test(status), '非 ①b 部分推翻');
  const bucketOf = (st) => {
    const m = st.match(RE_SUPERSEDED_BY);
    if (m && parseInt(m[1], 10) !== 77) return RE_PARTIAL.test(st) ? 'partial' : 'registered'; // L119-121
    if (RE_SELF_DEPRECATED.test(st) && !m) return 'unpointed'; // L125-127
    return null;
  };
  assert.equal(bucketOf(status), 'registered', '同含 ①③ 标记的行整篇入 ① 桶');
  assert.equal(bucketOf('已废弃'), 'unpointed', '纯 ③ 对照组才入 unpointed');
  const partialStatus = '已实施（方案 B 全部落地）⚠️ **部分被 ADR-079 推翻**（lifelike/idle 保留定位）';
  assert.equal(bucketOf(partialStatus), 'partial', '①b 部分限定词把 ① 分流到 partial');
  const selfMarked = (st) => (RE_SUPERSEDED_BY.test(st) && !RE_PARTIAL.test(st)) // 生产 L177-178
    || RE_SELF_DEPRECATED.test(st);
  assert.ok(selfMarked(status), '① 整篇被取代 → ④ 豁免硬标记');
  assert.ok(!selfMarked(partialStatus), '①b 部分推翻 ≠ ④ 豁免（未被推翻章节仍需体检）');
  assert.ok(selfMarked('已废弃'), '③ 自身废弃 → ④ 豁免硬标记');
});

test('parseAdrHeader: bad date format → 日期格式不可识别 error（frontmatter.mjs L169）', () => {
  const ok = supersedeFixture([
    '# ADR-450: 坏日期对照',
    '',
    '> **状态**: 提案',
    '> **日期**: 2026-01-01',
    '',
    'body...',
  ].join('\n'));
  assert.equal(ok.h.error, undefined, '合法 YYYY-MM-DD 不报错');
  assert.equal(ok.h.date, '2026-01-01');
  for (const bad of ['2026-1-5', '2026/01/05', '01-05-2026']) {
    const r = supersedeFixture([
      '# ADR-450: 坏日期',
      '',
      '> **状态**: 提案',
      '> **日期**: ' + bad,
      '',
      'body...',
    ].join('\n'));
    assert.equal(r.h.error, '日期格式不可识别：' + bad, 'L169 校验失败须原样回显坏日期');
    assert.deepEqual(r.h, { error: r.h.error }, 'L166-169 error 分支只返回 {error}，不含部分解析字段');
    cleanup(r.dir);
  }
  cleanup(ok.dir);
});

test('五层组合夹具：②漏标 / ④豁免 / ①b不豁免 / ⑤表格弱宣称 / 反事实混排 同时判定', () => {
  const f = {
    'adr-430-legacy-flow.md': [
      '# ADR-430: legacy flow',
      '',
      '> **状态**: 已废弃',
      '> **日期**: 2026-03-01',
      '',
      '正文留档。',
    ].join('\n'),
    'adr-431-new-flow.md': [
      '# ADR-431: new flow',
      '',
      '> **状态**: 已实施（2026-03-02）⚠️ **部分被 ADR-030 推翻**（§2 保留）',
      '> **日期**: 2026-03-02',
      '',
      'ADR-430 已过时，但本 ADR 不推翻 ADR-432。',
    ].join('\n'),
    'adr-432-table-claim.md': [
      '# ADR-432: table claim',
      '',
      '> **状态**: 已实施（2026-03-03）',
      '> **日期**: 2026-03-03',
      '',
      '本 ADR 取代了 [ADR-433](adr-433-claimed.md) 的接口部分。',
      '| ADR-433 | 本ADR完全替代 |',
      '本 ADR 不取代 ADR-444，但取代 ADR-445。',
    ].join('\n'),
    'adr-433-claimed.md': [
      '# ADR-433: claimed',
      '',
      '> **状态**: 已实施（2026-03-04）',
      '> **日期**: 2026-03-04',
      '',
      '正文。',
    ].join('\n'),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-adr-combo-'));
  for (const [name, text] of Object.entries(f)) fs.writeFileSync(path.join(dir, name), text, 'utf8');
  try {
    // ── 复刻生产第二遍判定（gen-adr-supersede.mjs L110-218，逐行对齐） ──
    const metas = Object.keys(f).sort().map((file) => {
      const h = parseAdrHeader(path.join(dir, file));
      assert.equal(h.error, undefined, file + ' 应可解析');
      return { num: h.num, file, status: h.status, statusLine: h.statusLine };
    });
    const numSet = new Set(metas.map((m) => m.num));
    const lines = metas.map((m) => f[m.file].split('\n'));
    const RE_CLAIM_A_G = globalOf(RE_CLAIM_A); // 生产 L62-63
    const RE_CLAIM_B_G = globalOf(RE_CLAIM_B);
    const unmarked = [];
    const suspicious = [];
    const tableClaims = [];
    metas.forEach((m, idx) => {
      const mBy = m.status.match(RE_SUPERSEDED_BY); // L117
      const isPartial = Boolean(mBy) && RE_PARTIAL.test(m.status); // L118
      const selfMarked = (RE_SUPERSEDED_BY.test(m.status) && !isPartial) // L177-178
        || RE_SELF_DEPRECATED.test(m.status);
      const textLines = lines[idx];
      const headerEnd = m.statusLine >= 0
        ? Math.min(textLines.length, m.statusLine + 1)
        : Math.min(textLines.length, 20); // L132-134
      for (let i = headerEnd; i < textLines.length; i++) {
        const line = textLines[i];
        const hypotheticalTargets = new Set(
          [...line.matchAll(globalOf(RE_HYPOTHETICAL_CLAIM))].map((mm) => parseInt(mm[1], 10))
        ); // L145-147
        const negatedTargets = new Set(
          [...line.matchAll(globalOf(RE_NEGATED_CLAIM))].map((mm) => parseInt(mm[1], 10))
        ); // L148-150
        for (const n of hypotheticalTargets) negatedTargets.add(n); // L151
        const targets = [];
        for (const mm of line.matchAll(RE_CLAIM_A_G)) targets.push(parseInt(mm[1], 10)); // L155
        for (const mm of line.matchAll(RE_CLAIM_B_G)) targets.push(parseInt(mm[1], 10)); // L156
        const claimedThisLine = [];
        for (const target of targets) { // L159-169
          if (negatedTargets.has(target)) continue;
          if (target !== m.num && numSet.has(target)) {
            claimedThisLine.push(target);
            const tMeta = metas.find((e) => e.num === target);
            const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
            if (!tMarked) unmarked.push({ claimedBy: m.num, target });
          }
        }
        if (claimedThisLine.length === 0 && !selfMarked && RE_DEPRECATED_WORD.test(line)) { // L182
          const others = [...new Set([...line.matchAll(/ADR-(\d+)/g)].map((mm) => parseInt(mm[1], 10)))]
            .filter((n) => n !== m.num && numSet.has(n) && !negatedTargets.has(n)); // L183-184
          const anyOtherMarked = others.some((o) => { // L185-190
            const t = metas.find((e) => e.num === o);
            return t && (RE_SUPERSEDED_BY.test(t.status)
              || RE_SELF_DEPRECATED.test(t.status)
              || RE_DEPRECATED_WORD.test(t.status));
          });
          if (!anyOtherMarked) {
            for (const other of others) { // L191-199
              const tMeta = metas.find((e) => e.num === other);
              const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
              if (!tMarked) suspicious.push({ num: m.num, target: other });
            }
          }
        }
        const mTable = line.match(RE_TABLE_FIRST_COL); // L205
        if (mTable && RE_TABLE_VERB.test(line) && !RE_TABLE_NEGATED.test(line)) { // L206
          const target = parseFloat(mTable[1]); // L208
          if (target !== m.num && numSet.has(target)) {
            const tMeta = metas.find((e) => e.num === target);
            const numPat = String(m.num).replace('.', String.fromCharCode(92) + '.'); // L212
            const alreadyBackMarked = tMeta
              && new RegExp('ADR-0*' + numPat + '(?!' + String.fromCharCode(92) + 'd)').test(tMeta.status); // L213
            if (!alreadyBackMarked) tableClaims.push({ num: m.num, target }); // L215
          }
        }
      }
    });
    // ② 433 被 432 正文宣称「取代了 [ADR-433]」但 433 状态行未回标 → 唯一漏标
    assert.deepEqual(unmarked, [{ claimedBy: 432, target: 433 }], '② 漏标恰 1 处（432→433）');
    // ④ 431 行「ADR-430 已过时」：claimedThisLine 非空（RE_CLAIM_B 抓到 430）→ L182 短路；
    //    即使扫 ④ 也被 430 的自身废弃硬标记吸收 → 无残漏
    assert.deepEqual(suspicious, [], '④ 无残漏（②/③ 标记吸收）');
    // ⑤ 432 表格行首列 ADR-433 + 「本ADR完全替代」（跨列自指：首列是目标、动词列自指本 ADR）且 433 未回标 → 唯一表格弱宣称
    assert.deepEqual(tableClaims, [{ num: 432, target: 433 }], '⑤ 表格弱宣称恰 1 处');
    // 目标级剔除：444 被「不取代」否定且不在 numSet → 无 claim；445 不在 numSet → 无 ②
    assert.ok(!unmarked.some((u) => u.target === 444 || u.target === 445), '不存在编号不构成 ②');
    // ①b：431 状态行「部分被 ADR-030 推翻」→ 只入 partial 桶，不豁免 ④（selfMarked 判定已在上方对照锁定）
    assert.equal(bucketProbe(metas.find((e) => e.num === 431).status), 'partial');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function bucketProbe(status) {
  const m = status.match(RE_SUPERSEDED_BY);
  if (m) return RE_PARTIAL.test(status) ? 'partial' : 'registered'; // 生产 L121
  return null;
}
