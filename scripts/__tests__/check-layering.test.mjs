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
// [round-76c #9] R1（algo→menus）/ R3（algo→scene）零用例：fixture 增 2 个违规文件触 R1/R3
test('R1（algo→menus）零容忍：motion-algos import @/menus → r1 记录 + exit 1（不入库基线）', () => {
  const dir = makeFixture({
    'menus/m.ts': 'export const m = 1;\n',
    'motion-algos/aa.ts': "import { m } from '@/menus/m';\n",
  });
  try {
    const r = runCli(dir, ['--json'], NO_BASELINE);
    assert.equal(r.code, 1, `R1 应 exit 1: ${r.stdout} ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.equal(data.r1.length, 1, JSON.stringify(data.r1));
    assert.equal(data.r1[0].rule, 'R1');
    assert.equal(data.r1[0].from, 'motion-algos/aa.ts');
    assert.equal(data.r1[0].to, 'menus/m');
    assert.equal(data.r1[0].fromLayer, 'algo');
    assert.equal(data.r1[0].toLayer, 'menus');
    assert.equal(data.total, 0, 'R1 不属于 tracked（基线只跟踪 R2/R3）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('R3（algo→scene）：超基线 exit 1 / 基线含该边 exit 0（tracked 键 motion-algos/aa.ts:scene/s）', () => {
  const dir = makeFixture({
    'scene/s.ts': 'export const s = 1;\n',
    'motion-algos/aa.ts': "import { s } from '@/scene/s';\n",
  });
  const baselineFile = path.join(os.tmpdir(), `layering-r3-${process.pid}.json`);
  try {
    const fail = runCli(dir, ['--json'], NO_BASELINE);
    assert.equal(fail.code, 1, '无基线时 R3 边应判 regression');
    const fdata = JSON.parse(fail.stdout);
    assert.equal(fdata.regressions.length, 1, JSON.stringify(fdata.regressions));
    assert.equal(fdata.regressions[0].rule, 'R3');
    assert.equal(fdata.regressions[0].from, 'motion-algos/aa.ts');
    assert.equal(fdata.regressions[0].to, 'scene/s');
    assert.equal(fdata.r1.length, 0, '无 R1 违规');

    fs.writeFileSync(baselineFile, JSON.stringify({ entries: ['motion-algos/aa.ts:scene/s'] }), 'utf8');
    const ok = runCli(dir, ['--json'], baselineFile);
    assert.equal(ok.code, 0, `基线含 R3 边应 exit 0: ${ok.stdout} ${ok.stderr}`);
    const odata = JSON.parse(ok.stdout);
    assert.equal(odata.regressions.length, 0);
    assert.equal(odata.fixed.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(baselineFile, { force: true });
  }
});

// [round-76c #9] 相对 import 解析（check-layering.mjs:82-85）与裸包名跳过（:87）
test('相对 import 解析：越出 src 根 / 裸包名（@babylonjs、babylon-mmd）→ 不入分层判定', () => {
  const dir = makeFixture({
    'scene/s.ts': 'export const s = 1;\n',
    'core/out.ts': "import { s } from '../../out/s';\nimport * as babylon from '@babylonjs/core';\nimport { loadMMD } from 'babylon-mmd';\n",
  });
  try {
    // 相对 import '../../out/s' 越出 SRC_ROOT → resolveTarget null；裸包名 → null；无任何违规
    const r = runCli(dir, ['--json'], NO_BASELINE);
    assert.equal(r.code, 0, `越出根/裸包名不应产生违规: ${r.stdout} ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.equal(data.total, 0, JSON.stringify(data));
    assert.equal(data.regressions.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// [round-76c #9] --update 重写基线（check-layering.mjs:136-145）：基线 diff 断言
test('--update 重写基线：剔除已消除的旧键、写入当前 tracked 边 + generatedAt/_comment', () => {
  const dir = makeFixture({
    'scene/s.ts': 'export const s = 1;\n',
    'motion-algos/aa.ts': "import { s } from '@/scene/s';\n",
  });
  const baselineFile = path.join(os.tmpdir(), `layering-upd-${process.pid}.json`);
  try {
    fs.writeFileSync(baselineFile, JSON.stringify({ _comment: 'old', entries: ['core/gone.ts:scene/gone'] }), 'utf8');
    const upd = runCli(dir, ['--update'], baselineFile);
    assert.equal(upd.code, 0, `--update 应 exit 0: ${upd.stderr}`);
    assert.match(upd.stdout, /基线已更新/);
    const after = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    assert.deepEqual(after.entries, ['motion-algos/aa.ts:scene/s'], '基线 diff：旧键剔除、新键写入');
    assert.ok(!after.entries.includes('core/gone.ts:scene/gone'), '已消除边应从基线剔除');
    assert.match(after.generatedAt, /^\d{4}-\d{2}-\d{2}$/, 'generatedAt 为当日日期');
    assert.match(after._comment, /ADR-242/);

    // 复跑 --json：新基线内 0 regression、0 fixed
    const chk = runCli(dir, ['--json'], baselineFile);
    assert.equal(chk.code, 0);
    const cdata = JSON.parse(chk.stdout);
    assert.equal(cdata.regressions.length, 0);
    assert.equal(cdata.fixed.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(baselineFile, { force: true });
  }
});

test('--update 对 R1 零容忍不豁免：R1 边不入基线，复查仍 exit 1', () => {
  const dir = makeFixture({
    'menus/m.ts': 'export const m = 1;\n',
    'scene/s.ts': 'export const s = 1;\n',
    'motion-algos/aa.ts': "import { m } from '@/menus/m';\nimport { s } from '@/scene/s';\n",
  });
  const baselineFile = path.join(os.tmpdir(), `layering-r1upd-${process.pid}.json`);
  try {
    const upd = runCli(dir, ['--update'], baselineFile);
    assert.equal(upd.code, 0, `--update 本身 exit 0: ${upd.stderr}`);
    const after = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    assert.deepEqual(after.entries, ['motion-algos/aa.ts:scene/s'], 'R1 边（algo→menus）不得入库基线');
    const chk = runCli(dir, ['--json'], baselineFile);
    assert.equal(chk.code, 1, 'R1 零容忍：基线更新后复查仍 exit 1');
    const cdata = JSON.parse(chk.stdout);
    assert.equal(cdata.r1.length, 1);
    assert.equal(cdata.regressions.length, 0, 'R3 边已在基线内');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(baselineFile, { force: true });
  }
});
