#!/usr/bin/env node
/**
 * check-assertion-baseline.test.mjs
 * check-assertion-baseline.mjs（ADR-276 决策 5 断言 ratchet）契约测试。
 *
 * 策略：spawn 真实 CLI，用 ASSERTION_SRC / ASSERTION_BASELINE 指向临时 fixture，
 * 断言：
 *   - --help 退 0 且列出用法
 *   - 四类计数口径：非空断言 / as unknown as / as any / @ts-ignore（注释里的不算）
 *   - 测试文件不计入（__tests__ / *.test.ts）
 *   - 超基线 → exit 1，并点名越界文件
 *   - 基线缺失 → fail-closed（exit 2）
 *   - --update 拒绝上调（exit 1），但允许下降
 *
 * 运行：node --test scripts/__tests__/check-assertion-baseline.test.mjs
 *       （已挂入 npm run test:scripts）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPT = path.join(ROOT, 'scripts', 'check-assertion-baseline.mjs');

function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assertion-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return dir;
}

function runCli(srcDir, args = [], baselinePath) {
  const env = { ...process.env, ASSERTION_SRC: srcDir };
  if (baselinePath) env.ASSERTION_BASELINE = baselinePath;
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 60000, env,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const SAMPLES = {
  'a.ts': [
    'declare const maybe: { x: number } | undefined;',
    'export const v = maybe!.x;',            // nonNull 1
    'export const w = (maybe as unknown as { x: number }).x;', // doubleAssert 1
    'export const z = (maybe as any).y;',    // asAny 1
  ].join('\n'),
};

test('--help 退 0 且含用法说明', () => {
  const dir = makeFixture({ 'a.ts': '' });
  const baseline = path.join(dir, '.baseline.json');
  try {
    const r = runCli(dir, ['--help'], baseline);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
    assert.match(r.stdout, /check-assertion-baseline/);
    assert.match(r.stdout, /--update/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('四类断言计数口径正确', () => {
  const dir = makeFixture(SAMPLES);
  try {
    const r = runCli(dir, ['--json'], path.join(dir, 'missing.json'));
    // 基线缺失 → fail-closed，但 --json 之前就退出，故这里用 --update 生成基线再读
    const up = runCli(dir, ['--update'], path.join(dir, 'b.json'));
    assert.equal(up.code, 0, up.stderr);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'b.json'), 'utf8'));
    assert.equal(data.totals.nonNull, 1, JSON.stringify(r));
    assert.equal(data.totals.doubleAssert, 1);
    assert.equal(data.totals.asAny, 1);
    assert.equal(data.totals.tsIgnore, 0);
    assert.deepEqual(Object.keys(data.perFile), ['a.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('注释与测试文件不计入', () => {
  const dir = makeFixture({
    'a.ts': [
      '// 示例: foo!.bar 与 x as unknown as T 与 y as any 与 @ts-ignore',
      'export const ok = 1;',
    ].join('\n'),
    'b.test.ts': 'declare const q: any; export const v = q!.y as any;',
    '__tests__/c.ts': 'declare const q: any; export const v = q!.y;',
  });
  try {
    const baseline = path.join(dir, 'b.json');
    assert.equal(runCli(dir, ['--update'], baseline).code, 0);
    const data = JSON.parse(fs.readFileSync(baseline, 'utf8'));
    assert.deepEqual(data.totals, { nonNull: 0, doubleAssert: 0, asAny: 0, tsIgnore: 0 });
    assert.deepEqual(data.perFile, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('超基线 → exit 1 并点名文件', () => {
  const dir = makeFixture({ 'a.ts': 'declare const m: any; export const v = m!.x;\n' });
  const baseline = path.join(dir, 'b.json');
  try {
    assert.equal(runCli(dir, ['--update'], baseline).code, 0);
    // 基线写好后新增第二处非空断言
    fs.writeFileSync(path.join(dir, 'a.ts'), 'declare const m: any; export const v = m!.x; export const w = m!.y;\n');
    const r = runCli(dir, [], baseline);
    assert.equal(r.code, 1, `expected regression, got exit=${r.code}`);
    assert.match(r.stderr, /超出基线/);
    assert.match(r.stderr, /a\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('基线缺失 → fail-closed（exit 2）', () => {
  const dir = makeFixture({ 'a.ts': 'export const ok = 1;\n' });
  try {
    const r = runCli(dir, [], path.join(dir, 'nope.json'));
    assert.equal(r.code, 2, `expected fail-closed, got exit=${r.code}`);
    assert.match(r.stderr, /基线文件缺失/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--update 拒绝上调 / 允许下降', () => {
  const dir = makeFixture({ 'a.ts': 'declare const m: any; export const v = m!.x;\n' });
  const baseline = path.join(dir, 'b.json');
  try {
    assert.equal(runCli(dir, ['--update'], baseline).code, 0);
    // 上调：新增一处
    fs.writeFileSync(path.join(dir, 'a.ts'), 'declare const m: any; export const v = m!.x; export const w = m!.y;\n');
    const raise = runCli(dir, ['--update'], baseline);
    assert.equal(raise.code, 1, '基线只许降，上调必须拒绝');
    assert.match(raise.stderr, /只许降不许升/);
    // 下降：删掉一处
    fs.writeFileSync(path.join(dir, 'a.ts'), 'declare const m: any; export const v = m!.x;\n');
    assert.equal(runCli(dir, ['--update'], baseline).code, 0);
    const data = JSON.parse(fs.readFileSync(baseline, 'utf8'));
    assert.equal(data.totals.nonNull, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
