import assert from 'node:assert/strict';
import test from 'node:test';
import { isTypeOnlyBody, scanImportSpecs } from './import-scan.mjs';

const specs = (text) => scanImportSpecs(text).map((s) => s.spec);

test('静态 import/export-from：默认导入、具名、星号、as ns', () => {
  const text = [
    "import foo from './foo.js';",
    "import { a, b as c } from '@/core/a.js';",
    "export * from './star.ts';",
    "export * as ns from './ns.ts';",
    "export { x } from './x.ts';",
  ].join('\n');
  assert.deepEqual(specs(text).sort(), ['./foo.js', '@/core/a.js', './star.ts', './ns.ts', './x.ts'].sort());
});

test('副作用导入与动态导入', () => {
  const text = ["import './style.css';", "const m = await import('./lazy.js');", "if (x) { void import('@/menus/m.js'); }"].join('\n');
  assert.deepEqual(specs(text).sort(), ['./style.css', './lazy.js', '@/menus/m.js'].sort());
  assert.deepEqual(
    scanImportSpecs(text).map((s) => s.kind).sort(),
    ['dynamic', 'dynamic', 'side'],
  );
});

test('多行 import 与括号内注释（旧正则的假绿点）', () => {
  const text = [
    'import {',
    '  loadScene, // 说明',
    '  /* 块注释 */ playMmd,',
    "} from './target.ts';",
  ].join('\n');
  assert.deepEqual(specs(text), ['./target.ts']);
});

test('`}` 后换行再接 from 仍能识别', () => {
  const text = ['import {', '  a', '}', "from './split.ts';"].join('\n');
  assert.deepEqual(specs(text), ['./split.ts']);
});

test('export 声明式导出不产生导入边（旧正则灾难性回溯的触发形态）', () => {
  const text = [
    'export function setupE2ECapture(): void {',
    "  window.__foo = { a: '/b', c: \"d\" };",
    '}',
    "const other = 'from nope';",
  ].join('\n');
  assert.deepEqual(specs(text), []);
});

test('字符串/注释里的假 from 不被误判', () => {
  const text = [
    "export const banner = \"from '@/fake.js'\";",
    "// import nope from './comment.js'",
    "/* export * from './block.js' */",
    "import real from './real.ts';",
  ].join('\n');
  assert.deepEqual(specs(text), ['./real.ts']);
});

test('同一行前置块注释后的 import 仍计入（旧实现预处理成空格后能匹配）', () => {
  const text = [
    "/* eslint-disable no-console */ import a from './a.ts';",
    "  /* @ts-expect-error */ import './side.css';",
    "const x = 1; import b from './b.ts';", // 语句中间出现 → 两版都不计
  ].join('\n');
  assert.deepEqual(specs(text), ['./a.ts', './side.css']);
});

test('type-only 判定：import type / export type / 全 type 具名项', () => {
  const cases = [
    ["import type { A } from './a.ts';", true],
    ["import type A from './a.ts';", true],
    ["export type { A } from './a.ts';", true],
    ["export type * from './a.ts';", true],
    ["import { type A, type B } from './a.ts';", true],
    ["import { type A, B } from './a.ts';", false],
    ["import { A } from './a.ts';", false],
    ["import A from './a.ts';", false],
  ];
  for (const [src, expected] of cases) {
    const hit = scanImportSpecs(src);
    assert.equal(hit.length, 1, src);
    assert.equal(isTypeOnlyBody(hit[0].body), expected, src);
  }
});

test('type 声明（非 re-export）不产生边', () => {
  const text = ["export type Foo = { a: string };", "export type Bar = keyof Foo;"].join('\n');
  assert.deepEqual(specs(text), []);
});

test('上一行注释以 `.` 结尾不影响下一行 import（曾被误判为成员访问 x.import）', () => {
  const text = ['// 上一行以句点结尾.', "import x from './x.ts';"].join('\n');
  assert.deepEqual(specs(text), ['./x.ts']);
});

test('类型位置动态 import 标记 typeOnly，表达式位置不标记', () => {
  const cases = [
    ["export function f(scene: import('@babylonjs/core/scene').Scene): void {}", true],
    ["type S = typeof import('./scene.ts');", true],
    ["const m = await import('./lazy.ts');", false],
    ["const p = import('./lazy.ts').then((m) => m);", false],
    ["if (x) { void import('./lazy.ts'); }", false],
  ];
  for (const [src, expected] of cases) {
    const hit = scanImportSpecs(src);
    assert.equal(hit.length, 1, src);
    assert.equal(hit[0].typeOnly === true, expected, src);
  }
});

test('index 指向语句关键字，可用于行号换算', () => {
  const text = ["const a = 1;", "import x from './x.ts';"].join('\n');
  const [hit] = scanImportSpecs(text);
  assert.equal(text.slice(hit.index, hit.index + 6), 'import');
  assert.equal(text.slice(0, hit.index).split('\n').length, 2);
});

test('病理输入线性完成（回溯实现会指数爆炸）', () => {
  // 每条语句形如 dev-hooks.ts 的导出函数头：不含 from，含大量 / 与引号
  const unit = 'export function f(){ const s = "a/b"; /* c */ }';
  const text = Array.from({ length: 30 }, (_, i) => `${unit} // ${i}`).join('\n');
  const started = Date.now();
  assert.deepEqual(specs(text), []);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `扫描耗时 ${elapsed}ms，疑似回溯实现`);
});
