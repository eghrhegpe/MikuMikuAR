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
 * 策略：spawn 真实 CLI（execFileSync），cwd 指向临时目录（含 docs/adr 夹具）。
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
import { execFileSync } from 'node:child_process';
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

/** spawn new-adr CLI（cwd=临时夹具），返回 { code, stdout, stderr } */
function runNewAdr(dir, args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
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
