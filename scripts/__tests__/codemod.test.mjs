#!/usr/bin/env node
/**
 * codemod.test.mjs
 * codemod.mjs 三命令（rename-function / move-function / add-param）fixture 测试。
 *
 * 策略：spawn 真实 CLI（非 import 内部函数），通过 CODEMOD_FRONTEND 环境变量
 * 指向临时 fixture 目录，断言文件内容与退出码 —— 不触碰真实 frontend 代码。
 *
 * 覆盖：
 *   - rename-function：改名 + 引用同步；重复运行幂等拒绝
 *   - move-function：迁移 + 源文件 re-export；本地符号引用拒绝；多声明符拒绝；
 *                     重复运行自引用拒绝
 *   - add-param：定义加参 + 调用方补 undefined
 *
 * 运行：node --test scripts/__tests__/codemod.test.mjs
 *       （已挂入 npm run test:scripts）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPT = path.join(ROOT, 'scripts', 'codemod.mjs');

/** 最小可编译 fixture：tsconfig + src/*.ts */
function makeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codemod-test-'));
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
        lib: ['ES2020'],
      },
      include: ['src'],
    }),
    'utf8'
  );
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return dir;
}

/** spawn codemod CLI，返回 { code, stdout, stderr } */
function runCodemod(fixtureDir, args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, CODEMOD_FRONTEND: fixtureDir },
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

function read(fixtureDir, rel) {
  return fs.readFileSync(path.join(fixtureDir, rel), 'utf8');
}

test('rename-function: 定义与引用同步改名，且幂等拒绝重复运行', () => {
  const dir = makeFixture({
    'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
    'src/app.ts': "import { add } from './math';\nexport const r = add(1, 2);\n",
  });
  try {
    const r = runCodemod(dir, ['rename-function', 'add', 'sum']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
    assert.match(read(dir, 'src/math.ts'), /export function sum/);
    assert.doesNotMatch(read(dir, 'src/math.ts'), /\badd\b/);
    assert.match(read(dir, 'src/app.ts'), /import \{ sum \}/);
    assert.match(read(dir, 'src/app.ts'), /sum\(1, 2\)/);

    // 幂等：旧名已不存在 → exit 1
    const again = runCodemod(dir, ['rename-function', 'add', 'sum']);
    assert.equal(again.code, 1, '重复 rename 旧名应退出 1');
    assert.match(again.stdout + again.stderr, /未找到导出符号/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('move-function: 迁移函数 + 源文件补 re-export + importer 不断裂', () => {
  const dir = makeFixture({
    'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
    'src/app.ts': "import { add } from './math';\nexport const r = add(1, 2);\n",
    'src/util.ts': 'export const K = 1;\n',
  });
  try {
    const r = runCodemod(dir, ['move-function', 'add', 'src/util.ts']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
    // 定义迁入目标文件
    assert.match(read(dir, 'src/util.ts'), /export function add/);
    // 源文件补 re-export（保留既有 import 方；项目用显式 .ts 扩展名风格）
    assert.match(read(dir, 'src/math.ts'), /export \{ add \} from '\.\/util\.ts'/);
    // importer 无需改动
    assert.match(read(dir, 'src/app.ts'), /import \{ add \} from '\.\/math'/);

    // 重复运行：定义已在目标文件，源=目标 → exit 1
    const again = runCodemod(dir, ['move-function', 'add', 'src/util.ts']);
    assert.equal(again.code, 1, '重复 move 到自身应退出 1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('move-function: 函数体引用源文件本地符号 → 拒绝并列出', () => {
  const dir = makeFixture({
    'src/math.ts': 'const BASE = 10;\nexport function add(a: number): number { return a + BASE; }\n',
    'src/util.ts': 'export const K = 1;\n',
  });
  try {
    const r = runCodemod(dir, ['move-function', 'add', 'src/util.ts']);
    assert.equal(r.code, 1, '本地符号引用应拒绝');
    assert.match(r.stdout + r.stderr, /本地符号/);
    assert.match(r.stdout + r.stderr, /BASE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('move-function: 多声明符变量语句 → 拒绝（防丢兄弟声明符）', () => {
  const dir = makeFixture({
    'src/math.ts': 'export const A = 1, B = 2;\n',
    'src/util.ts': 'export const K = 1;\n',
  });
  try {
    const r = runCodemod(dir, ['move-function', 'A', 'src/util.ts']);
    assert.equal(r.code, 1, '多声明符应拒绝');
    assert.match(r.stdout + r.stderr, /声明符/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('move-function: 变量形态迁移保留 export/const 关键字', () => {
  const dir = makeFixture({
    'src/math.ts': 'export const VERSION = "1.0";\n',
    'src/util.ts': 'export const K = 1;\n',
  });
  try {
    const r = runCodemod(dir, ['move-function', 'VERSION', 'src/util.ts']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
    assert.match(read(dir, 'src/util.ts'), /export const VERSION = "1\.0";/);
    assert.match(read(dir, 'src/math.ts'), /export \{ VERSION \} from '\.\/util\.ts'/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add-param: 定义加参 + 调用方补 undefined', () => {
  const dir = makeFixture({
    'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
    'src/app.ts': "import { add } from './math';\nexport const r = add(1, 2);\n",
  });
  try {
    // 可空类型：调用方补 undefined 不产生类型错误，走通成功路径
    const r = runCodemod(dir, ['add-param', 'add', 'flag: boolean | undefined']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
    assert.match(read(dir, 'src/math.ts'), /add\(a: number, b: number, flag: boolean \| undefined\)/);
    assert.match(read(dir, 'src/app.ts'), /add\(1, 2, undefined\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add-param: 非可空参数补 undefined → P1-4 诊断门禁拦截（exit 1）', () => {
  const dir = makeFixture({
    'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
    'src/app.ts': "import { add } from './math';\nexport const r = add(1, 2);\n",
  });
  try {
    // 补 undefined 到 boolean 参数在 strict 下是类型错误，诊断门禁应拦截
    const r = runCodemod(dir, ['add-param', 'add', 'flag: boolean']);
    assert.equal(r.code, 1, '类型未通过校验应 exit 1');
    assert.match(r.stderr + r.stdout, /新增 \d+ 组诊断错误/);
    assert.match(r.stderr + r.stdout, /not assignable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add-param: 带默认值时调用方不修改', () => {
  const dir = makeFixture({
    'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
    'src/app.ts': "import { add } from './math';\nexport const r = add(1, 2);\n",
  });
  try {
    const r = runCodemod(dir, ['add-param', 'add', 'flag: boolean', 'false']);
    assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
    assert.match(read(dir, 'src/math.ts'), /flag: boolean = false/);
    assert.doesNotMatch(read(dir, 'src/app.ts'), /undefined/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('参数校验: 未知命令 / flag 顶位 → exit 1', () => {
  const dir = makeFixture({
    'src/math.ts': 'export function add(a: number, b: number): number { return a + b; }\n',
  });
  try {
    const unknown = runCodemod(dir, ['no-such-command', 'x']);
    assert.equal(unknown.code, 1);

    const flagTop = runCodemod(dir, ['rename-function', 'add', '--dry-run']);
    assert.equal(flagTop.code, 1, 'flag 顶位应拒绝而非当新名使用');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
