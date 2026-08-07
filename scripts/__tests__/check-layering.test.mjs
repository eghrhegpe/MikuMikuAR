#!/usr/bin/env node
/**
 * check-layering.test.mjs
 * check-layering.mjs（ADR-242 分层依赖方向守护）冒烟/契约测试。
 *
 * 策略：spawn 真实 CLI，通过 LAYERING_SRC / LAYERING_BASELINE 环境变量
 * 指向临时 fixture 目录，断言：
 *   - --help 退 0（P1 回归：此前 fs 未导入必崩）
 *   - 动态 import（await import()）被捕获（P2-1 回归）
 *   - 多行 import 被捕获（P2-2 回归）
 *   - type-only import 豁免（import type / { type A }）
 *   - 基线比对：超出基线 → exit 1；基线缺失 → fail-closed
 *
 * 运行：node --test scripts/__tests__/check-layering.test.mjs
 *       （已挂入 npm run test:scripts）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPT = path.join(ROOT, 'scripts', 'check-layering.mjs');

/** 建 fixture：tmp/src/{core,scene,menus,motion-algos} 目录 + 文件 */
function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layering-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return dir;
}

/** spawn check-layering CLI，返回 { code, stdout, stderr } */
function runCli(srcDir, args = [], baselinePath) {
  const env = { ...process.env, LAYERING_SRC: srcDir };
  if (baselinePath) env.LAYERING_BASELINE = baselinePath;
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000, env,
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

const NO_BASELINE = path.join(os.tmpdir(), `layering-baseline-${process.pid}.json`); // 指向不存在文件 → fail-closed

test('--help 退 0 且含用法说明（P1 回归：fs 未导入崩溃）', () => {
  const dir = makeFixture({ 'core/a.ts': '' });
  try {
    const r = runCli(dir, ['--help']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
    assert.match(r.stdout, /check-layering/);
    assert.match(r.stdout, /--update/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('动态 import（await import()）→ core→scene 被捕获（P2-1 回归）', () => {
  const dir = makeFixture({
    'core/load.ts': "const m = await import('@/scene/manager/model-loader');\n",
    'scene/manager/model-loader.ts': 'export const x = 1;\n',
  });
  try {
    const r = runCli(dir, ['--json'], NO_BASELINE);
    assert.equal(r.code, 1, '动态 core→scene 边应超基线失败');
    const data = JSON.parse(r.stdout);
    assert.ok(data.regressions.some((v) => v.rule === 'R2' && v.from === 'core/load.ts'), JSON.stringify(data.regressions));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('多行 import → core→scene 被捕获（P2-2 回归）', () => {
  const dir = makeFixture({
    'core/load.ts': "import {\n  loadScene,\n} from '@/scene/manager/loader';\n",
    'scene/manager/loader.ts': 'export const loadScene = 1;\n',
  });
  try {
    const r = runCli(dir, ['--json'], NO_BASELINE);
    assert.equal(r.code, 1, '多行 core→scene 边应超基线失败');
    const data = JSON.parse(r.stdout);
    assert.ok(data.regressions.some((v) => v.rule === 'R2' && v.from === 'core/load.ts'), JSON.stringify(data.regressions));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [code_review P2] 括号内带注释的多行 import：body 组旧 `[^;"'/`]*?` 排除斜杠，
// 遇到 `// 说明` 注释即整体匹配失败 → import 边从分层图消失（R1/R2/R3 假绿）。
// body 改为 `(?:[^;"'`]|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*?` 后注释作为可跳过单元放行。
test('多行 import 带 // 注释 → core→scene 仍被捕获（code_review P2 回归）', () => {
  const dir = makeFixture({
    'core/load.ts': "import {\n  loadScene, // 场景加载器\n} from '@/scene/manager/loader';\n",
    'scene/manager/loader.ts': 'export const loadScene = 1;\n',
  });
  try {
    const r = runCli(dir, ['--json'], NO_BASELINE);
    assert.equal(r.code, 1, '带注释的多行 core→scene 边应超基线失败');
    const data = JSON.parse(r.stdout);
    assert.ok(data.regressions.some((v) => v.rule === 'R2' && v.from === 'core/load.ts'), JSON.stringify(data.regressions));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('多行 import 带 /* 块注释 */ → core→scene 仍被捕获（code_review P2 回归）', () => {
  const dir = makeFixture({
    'core/load.ts': "import {\n  /* 块注释 */\n  loadScene,\n} from '@/scene/manager/loader';\n",
    'scene/manager/loader.ts': 'export const loadScene = 1;\n',
  });
  try {
    const r = runCli(dir, ['--json'], NO_BASELINE);
    assert.equal(r.code, 1, '带块注释的多行 core→scene 边应超基线失败');
    const data = JSON.parse(r.stdout);
    assert.ok(data.regressions.some((v) => v.rule === 'R2' && v.from === 'core/load.ts'), JSON.stringify(data.regressions));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('type-only import 豁免（import type / { type A }）→ 不构成违规', () => {
  const dir = makeFixture({
    'core/a.ts': "import type { Scene } from '@/scene/manager/loader';\nimport { type B } from '@/scene/manager/other';\n",
    'scene/manager/loader.ts': 'export type Scene = {};\n',
    'scene/manager/other.ts': 'export type B = {};\n',
  });
  try {
    const r = runCli(dir, ['--json'], NO_BASELINE);
    // type-only 全部豁免 → 无违规 → exit 0
    assert.equal(r.code, 0, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.equal(data.regressions.length, 0, JSON.stringify(data.regressions));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('基线比对：基线含该边 → 通过；超出基线 → exit 1', () => {
  const dir = makeFixture({
    'core/load.ts': "import { x } from '@/scene/manager/loader';\n",
    'scene/manager/loader.ts': 'export const x = 1;\n',
  });
  const baselineFile = path.join(os.tmpdir(), `layering-base-${process.pid}.json`);
  try {
    // 基线含该边 → 通过
    fs.writeFileSync(baselineFile, JSON.stringify({ entries: ['core/load.ts:scene/manager/loader'] }), 'utf8');
    const ok = runCli(dir, ['--json'], baselineFile);
    assert.equal(ok.code, 0, `基线内应通过: ${ok.stdout}`);
    const okData = JSON.parse(ok.stdout);
    assert.equal(okData.regressions.length, 0);

    // 基线不含该边（换一个边名）→ 超基线 exit 1
    fs.writeFileSync(baselineFile, JSON.stringify({ entries: ['core/other.ts:scene/x'] }), 'utf8');
    const fail = runCli(dir, ['--json'], baselineFile);
    assert.equal(fail.code, 1, '超基线应失败');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(baselineFile, { force: true });
  }
});

test('基线缺失 → fail-closed（全部 tracked 边判为 regression，exit 1）', () => {
  const dir = makeFixture({
    'core/load.ts': "import { x } from '@/scene/manager/loader';\n",
    'scene/manager/loader.ts': 'export const x = 1;\n',
  });
  const missing = path.join(os.tmpdir(), `layering-none-${process.pid}.json`);
  try {
    const r = runCli(dir, ['--json'], missing);
    assert.equal(r.code, 1, '基线缺失应 fail-closed');
    const data = JSON.parse(r.stdout);
    assert.equal(data.regressions.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(missing, { force: true });
  }
});
