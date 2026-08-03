#!/usr/bin/env node
/**
 * check-cli.smoke.test.mjs
 * 顶层分析脚本冒烟测试 —— 防止「AI 的眼睛」悄悄坏掉。
 *
 * 策略：spawn 真实 CLI（非 import 内部函数），断言：
 *   1. 进程能跑完（exit 0）
 *   2. 输出含关键标识（符号名 / 标题行）
 *   3. 无未捕获错误（stderr 不含 ❌ / Error 崩溃）
 *
 * 刻意不硬编码行号/环数 —— 内容会随重构漂移，冒烟只验证「脚本活着」。
 * 覆盖：check-consumers（含 --json / --snapshot / --diff 快照闭环）
 *        check-circular（含 --edges / --snapshot / --diff 快照闭环）
 *
 * 运行：node --test scripts/check-cli.smoke.test.mjs
 *       （已挂入 npm run test:scripts）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPTS = path.join(ROOT, 'scripts');

/** spawn 脚本，返回 { code, stdout, stderr } */
function runScript(scriptName, args = []) {
  const result = { code: 0, stdout: '', stderr: '' };
  try {
    result.stdout = execFileSync(process.execPath, [scriptName, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
    });
  } catch (e) {
    result.code = e.status ?? 1;
    result.stdout = e.stdout?.toString() ?? '';
    result.stderr = e.stderr?.toString() ?? '';
  }
  return result;
}

// ── check-consumers 冒烟 ──

test('check-consumers: FootLandEvent 查询跑通且含定义', () => {
  const r = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /FootLandEvent/);
  assert.match(r.stdout, /motion-algos\/feet-event\.ts/); // ADR-238 Phase 1 下沉点
  assert.doesNotMatch(r.stderr, /Error|❌/);
});

test('check-consumers: --json 输出合法且含 definitions', () => {
  const r = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent', '--json']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.stdout);
  assert.ok(Array.isArray(data.definitions));
  assert.ok(data.definitions.some((d) => d.includes('feet-event')));
});

test('check-consumers: --snapshot → --diff 闭环自身无变化', () => {
  const snap = path.join(os.tmpdir(), `consumers-smoke-${process.pid}.json`);
  try {
    const s = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent', '--snapshot', snap]);
    assert.equal(s.code, 0, s.stderr);
    assert.ok(fs.existsSync(snap), '快照文件应生成');

    const d = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent', '--diff', snap]);
    assert.equal(d.code, 0, d.stderr);
    assert.match(d.stdout, /无变化|结论：\+/);
  } finally {
    try { fs.rmSync(snap, { force: true }); } catch {}
  }
});

test('check-consumers: 未命中符号 → 干净叶子提示（exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['__SmokeNoSuchSymbol_9x__']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /未找到任何引用|干净叶子/);
});

// ── check-circular 冒烟 ──

test('check-circular: 扫描跑通且输出模块数', () => {
  const r = runScript(path.join(SCRIPTS, 'check-circular.mjs'));
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /扫描到 \d+ 个模块/);
});

test('check-circular: --edges 归因输出可解析', () => {
  const r = runScript(path.join(SCRIPTS, 'check-circular.mjs'), ['--edges']);
  assert.equal(r.code, 0);
  // 有环时输出环路径；无环时输出 ✅。两者都算脚本健康
  assert.ok(/扫描到|✅ 未检测到|→/.test(r.stdout));
});

test('check-circular: --snapshot → --diff 闭环自身无新增环', () => {
  const snap = path.join(os.tmpdir(), `circular-smoke-${process.pid}.json`);
  try {
    const s = runScript(path.join(SCRIPTS, 'check-circular.mjs'), ['--snapshot', snap]);
    assert.equal(s.code, 0, s.stderr);
    assert.ok(fs.existsSync(snap), '快照文件应生成');

    const d = runScript(path.join(SCRIPTS, 'check-circular.mjs'), ['--diff', snap]);
    assert.equal(d.code, 0, d.stderr);
    assert.match(d.stdout, /基线快照|无新增环/);
  } finally {
    try { fs.rmSync(snap, { force: true }); } catch {}
  }
});
