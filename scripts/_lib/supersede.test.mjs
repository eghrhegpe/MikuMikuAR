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
