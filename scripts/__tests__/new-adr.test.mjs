#!/usr/bin/env node
/**
 * new-adr.test.mjs
 * new-adr.mjs 冒烟测试 —— 覆盖 2026-08-06 复审后 P2 修复的高风险语义：
 *   - --supersedes 首次标注内容（blockquote 格式）
 *   - 重复 --supersedes 更新既有标注（无双后缀、无重复标注）
 *   - CRLF 文件标注后保持 CRLF
 *   - table 格式状态行插入不破坏表格
 *   - 按号锁文件被占用 → exit 1（并发占号保护）
 *
 * 策略：spawn 真实 CLI（spawnSync），cwd 指向临时目录（含 docs/adr 夹具）。
 * git ls-tree origin/main 失败自动降级为本地取号；gen-status-index 失败仅 warn，
 * 均不阻断本测试断言。
 *
 * 运行：node --test scripts/__tests__/new-adr.test.mjs
 *       （已挂入 npm run test:scripts）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPT = path.join(ROOT, 'scripts', 'new-adr.mjs');

/** 建临时仓库夹具：tmpdir/docs/adr + 可选 adr 文件，返回 { dir, adrDir } */
function makeAdrDir(adrFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-adr-test-'));
  const adrDir = path.join(dir, 'docs', 'adr');
  fs.mkdirSync(adrDir, { recursive: true });
  for (const [name, content] of Object.entries(adrFiles)) {
    fs.writeFileSync(path.join(adrDir, name), content, 'utf8');
  }
  return { dir, adrDir };
}

/**
 * spawn new-adr CLI（cwd=临时夹具），返回 { code, stdout, stderr }。
 * 用 spawnSync 而非 execFileSync：后者只在失败时返回 stderr，成功时丢弃，
 * 导致「exit 0 但 console.warn 提示」的路径（如手工标注保护）无法断言。
 */
function runNewAdr(dir, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 30000,
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function read(adrDir, name) {
  return fs.readFileSync(path.join(adrDir, name), 'utf8');
}

const BLOCKQUOTE_ADR = '# ADR-001: 旧决策\n\n> **状态**: ✅ 已采纳\n> **日期**: 2026-01-01\n\n正文。\n';

test('--supersedes: blockquote 状态行首次标注「被 [ADR-NNN] 取代」', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'ADR-001']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
    // 新 ADR 文件创建（本地 max=1 → next=2）
    assert.ok(fs.existsSync(path.join(adrDir, 'adr-002-new-one.md')), '应创建 adr-002-new-one.md');
    // 被取代方状态行被标注
    const target = read(adrDir, 'adr-001-old.md');
    assert.match(target, />\s*\*\*状态\*\*: ✅ 已采纳 ⚠️ 被 \[ADR-002\]\(adr-002-new-one\.md\) 取代（new-adr\.mjs 自动标注）/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--supersedes: 再次标注同目标 → 更新为最新取代者（无双后缀、无重复）', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  try {
    const r1 = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'ADR-001']);
    assert.equal(r1.code, 0, r1.stderr);
    // 第二次：next=3，被取代方已有工具格式标注（ADR-002）→ 更新为 ADR-003
    const r2 = runNewAdr(dir, ['另一决策', '--slug', 'new-two', '--supersedes', 'ADR-001']);
    assert.equal(r2.code, 0, `exit=${r2.code} stderr=${r2.stderr} stdout=${r2.stdout}`);
    const target = read(adrDir, 'adr-001-old.md');
    assert.match(target, /被 \[ADR-003\]\(adr-003-new-two\.md\) 取代/);
    // 无双后缀：更新时连旧后缀一起替换
    const markCount = (target.match(/new-adr\.mjs 自动标注/g) || []).length;
    assert.equal(markCount, 1, `自动标注后缀应只有 1 个，实际 ${markCount} 个：\n${target}`);
    // 无重复取代标注（只有 ADR-003，没有 ADR-002 残留）
    assert.doesNotMatch(target, /被 \[ADR-002\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--supersedes: CRLF 文件标注后保持 CRLF', () => {
  const crlf = BLOCKQUOTE_ADR.replace(/\n/g, '\r\n');
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': crlf });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'ADR-001']);
    assert.equal(r.code, 0, r.stderr);
    const raw = fs.readFileSync(path.join(adrDir, 'adr-001-old.md'), 'utf8');
    assert.ok(raw.includes('\r\n'), '文件应保持 CRLF');
    assert.doesNotMatch(raw, /[^\r]\n/, '不应混入裸 LF');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--supersedes: table 状态行插入不破坏表格（插在末位 | 前）', () => {
  const tableAdr = '# ADR-001: 表格格式\n\n| **状态** | 已采纳 |\n| **日期** | 2026-01-01 |\n\n正文。\n';
  const { dir, adrDir } = makeAdrDir({ 'adr-001-table.md': tableAdr });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'ADR-001']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
    const target = read(adrDir, 'adr-001-table.md');
    // 标注插在末位 | 之前，行尾仍是 |（表格结构完整）。
    // 单元格尾部空格 + insert 前导空格 → 两处连续空格，用 \s+ 匹配
    assert.match(target, /\|\s*\*\*状态\*\*\s*\|\s*已采纳\s+⚠️ 被 \[ADR-002\]\(adr-002-new-one\.md\) 取代（new-adr\.mjs 自动标注）\|/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('按号锁文件被占用 → exit 1（并发占号保护）', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  // 预置锁文件：next=2 → 补零文件名 adr-002 → 锁 .adr-002.lock（模拟并发进程占号中）
  fs.writeFileSync(path.join(adrDir, '.adr-002.lock'), `${process.pid}\n`, 'utf8');
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one']);
    assert.equal(r.code, 1, '锁被占用应 exit 1');
    assert.match(r.stdout + r.stderr, /正在被其他进程占号|锁文件/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--dry-run: 只算号不写文件（exit 0 且零写盘）', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /未写入任何文件/);
    const files = fs.readdirSync(adrDir);
    assert.deepEqual(files.sort(), ['adr-001-old.md'], 'dry-run 不应创建任何文件（含锁）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [round-76c #10] 多值 --supersedes 中英文逗号混用（new-adr.mjs:79 按 /[，,]/ split + trim）
test('--supersedes 多值（全角、半角逗号 + 空格混用）：3 个目标全部标注「被 [ADR-004] 取代」', () => {
  const mk = (n) => {
    return '# ADR-' + n + ': 旧决策\n\n> **状态**: ✅ 已采纳\n> **日期**: 2026-01-01\n\n正文。\n';
  };
  const { dir, adrDir } = makeAdrDir({
    'adr-001-old.md': mk('001'),
    'adr-002-old.md': mk('002'),
    'adr-003-old.md': mk('003'),
  });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'multi', '--supersedes', 'ADR-001，ADR-002, ADR-003']);
    assert.equal(r.code, 0, 'exit=' + r.code + ' stderr=' + r.stderr);
    assert.ok(fs.existsSync(path.join(adrDir, 'adr-004-multi.md')), '应创建 adr-004-multi.md（本地最大 3 → 4）');
    for (const n of ['001', '002', '003']) {
      const t = read(adrDir, 'adr-' + n + '-old.md');
      assert.ok(t.includes('被 [ADR-004](adr-004-multi.md) 取代（new-adr.mjs 自动标注）'), 'adr-' + n + ' 应被标注: ' + t);
      const marks = t.split('new-adr.mjs 自动标注').length - 1;
      assert.equal(marks, 1, 'adr-' + n + ' 标注应恰 1 处，实际 ' + marks);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [round-76c #10] validateSupersedes 失败路径（new-adr.mjs:262-289）：指向不存在 ADR → exit 1、不建文件、不留锁
test('--supersedes 指向不存在 ADR → exit 1（validateSupersedes fail-closed，不创建新文件、不残留锁）', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'ADR-999']);
    assert.equal(r.code, 1, '目标不存在应 exit 1');
    assert.ok(r.stderr.includes('未找到 adr-999-*'), '应提示文件未找到: ' + r.stderr);
    assert.ok(r.stderr.includes('校验失败'), '应提示目标校验失败: ' + r.stderr);
    const files = fs.readdirSync(adrDir).filter((f) => f.startsWith('adr-'));
    assert.deepEqual(files, ['adr-001-old.md'], '校验失败不得创建新文件');
    const locks = fs.readdirSync(adrDir).filter((f) => f.includes('.lock'));
    assert.equal(locks.length, 0, '不得残留锁文件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--supersedes 多值含一个不存在 → 整体 exit 1，合法目标不被标注（校验先于落盘）', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'ADR-001，ADR-999']);
    assert.equal(r.code, 1, '多值任一失败应整体 exit 1');
    assert.ok(r.stderr.includes('未找到 adr-999-*'), r.stderr);
    assert.equal(read(adrDir, 'adr-001-old.md'), BLOCKQUOTE_ADR, '合法目标 ADR-001 不应被标注（无半成品）');
    assert.ok(!fs.existsSync(path.join(adrDir, 'adr-002-new-one.md')), '不得创建新 ADR 文件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--supersedes 无法解析 ref（无数字）→ exit 1 并提示「无法解析」', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'XYZ']);
    assert.equal(r.code, 1, '无法解析 ref 应 exit 1');
    assert.ok(r.stderr.includes('无法解析'), r.stderr);
    assert.ok(!fs.existsSync(path.join(adrDir, 'adr-002-new-one.md')), '不得创建新 ADR 文件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [round-76c #10] 子编号 ADR-061.1：tPad 保留子号（061.1），不误标父文件 adr-061-*
test('--supersedes ADR-061.1 子编号：标注落到子号文件，父文件 adr-061-* 不被误标', () => {
  const sub = '# ADR-061.1: 子编号决策\n\n> **状态**: ✅ 已采纳\n> **日期**: 2026-01-01\n\n正文。\n';
  const parent = '# ADR-061: 父决策\n\n> **状态**: ✅ 已采纳\n> **日期**: 2026-01-01\n\n正文。\n';
  const { dir, adrDir } = makeAdrDir({
    'adr-061.1-sub.md': sub,
    'adr-061-parent.md': parent,
  });
  try {
    const r = runNewAdr(dir, ['子编号测试', '--slug', 'sub', '--supersedes', 'ADR-061.1']);
    assert.equal(r.code, 0, 'exit=' + r.code + ' stderr=' + r.stderr);
    // 本地最大 61（adr-061.1-* 不计入主号）→ next 62
    const t = read(adrDir, 'adr-061.1-sub.md');
    assert.ok(t.includes('被 [ADR-062](adr-062-sub.md) 取代（new-adr.mjs 自动标注）'), '子号文件应被标注: ' + t);
    const p = read(adrDir, 'adr-061-parent.md');
    assert.ok(!p.includes('取代'), '父文件不应被误标（若截断成 061 会标到父文件）');
    assert.ok(fs.existsSync(path.join(adrDir, 'adr-062-sub.md')), '应创建新 ADR-062');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [round-76c #10] 手工格式保护（new-adr.mjs:334-338）：非工具格式的既有标注不自动覆盖
test('--supersedes 目标已有手工格式「被 [ADR-005] 取代」标注 → 不自动覆盖（warn 提示人工核对）、exit 0', () => {
  const manual = '# ADR-001: 旧决策\n\n> **状态**: ✅ 已采纳 ⚠️ 被 [ADR-005] 取代（手工注记）\n> **日期**: 2026-01-01\n\n正文。\n';
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': manual });
  try {
    const r = runNewAdr(dir, ['新决策', '--slug', 'new-one', '--supersedes', 'ADR-001']);
    assert.equal(r.code, 0, '手工标注保护是 warn 非 error: ' + r.stderr);
    const t = read(adrDir, 'adr-001-old.md');
    assert.equal(t, manual, '手工格式标注应原样保留、不得自动覆盖');
    assert.ok(r.stderr.includes('未自动覆盖') || r.stderr.includes('请人工核对'), '应 warn 提示人工核对: ' + r.stderr);
    assert.ok(fs.existsSync(path.join(adrDir, 'adr-002-new-one.md')), '新 ADR 文件照常创建');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [round-76c #10] --reserve 占号模式：状态强制「规划」+ 占号注释行（覆盖位置参数状态）
test('--reserve 占号模式：状态强制「规划」+ 占号注释行（覆盖位置参数状态）', () => {
  const { dir, adrDir } = makeAdrDir({ 'adr-001-old.md': BLOCKQUOTE_ADR });
  try {
    const r = runNewAdr(dir, ['占位标题', '副题', '进行中', '--slug', 'reserved', '--reserve']);
    assert.equal(r.code, 0, 'exit=' + r.code + ' stderr=' + r.stderr);
    const t = read(adrDir, 'adr-002-reserved.md');
    assert.ok(t.includes('> **状态**: 规划（'), '状态应强制为「规划」（覆盖位置参数「进行中」）: ' + t);
    assert.ok(!t.includes('进行中'), '位置参数状态不应残留');
    assert.ok(t.includes('> **占号**: 本 ADR 为占位立档'), '应含占号注释行: ' + t);
    assert.ok(r.stdout.includes('占号模式'), 'stdout 应提示占号模式');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [round-76c #10] --related 预填「相关文档」行；无 --related 时保留占位注释
test('--related 预填「相关文档」行；无 --related 时保留占位注释', () => {
  const { dir, adrDir } = makeAdrDir({});
  try {
    const r1 = runNewAdr(dir, ['标题 A', '--slug', 'rel', '--related', 'ADR-113 / scene/env-water.ts']);
    assert.equal(r1.code, 0, r1.stderr);
    const t1 = read(adrDir, 'adr-001-rel.md');
    assert.ok(t1.includes('> ADR-113 / scene/env-water.ts'), '应预填相关文档行: ' + t1);
    assert.ok(!t1.includes('<!-- 关联的 ADR / 知识卡 / 代码文件 -->'), '预填时不应输出占位注释');

    const r2 = runNewAdr(dir, ['标题 B', '--slug', 'plain']);
    assert.equal(r2.code, 0, r2.stderr);
    const t2 = read(adrDir, 'adr-002-plain.md');
    assert.ok(t2.includes('<!-- 关联的 ADR / 知识卡 / 代码文件 -->'), '非 --related 应保留占位注释: ' + t2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

