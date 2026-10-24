import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { walkSourceFiles, getExportedSymbols, parseSourceImports, resolveSourceImport } from './source-graph.mjs';
// [P2 2026-08-06] 直测生产真身（去副本）：此前测试重实现 getModule/detectCycles 副本，
// 副本与生产同缺陷、给虚假信心。内部函数已 export，此处全部改为直测。
import { getModule, buildModuleGraph, detectCycles, cycleSetKey, representativeCycles, normalizeCycleKey } from '../check-circular.mjs';

// Helper: create temp fixture dir
function createFixtureDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-circular-test-'));
  return { root };
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ── parseSourceImports: edge cases ──

test('parseSourceImports: empty file → no imports', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'empty.ts');
  fs.writeFileSync(file, '', 'utf8');
  try {
    const imports = parseSourceImports(file, root);
    assert.deepEqual(imports, []);
  } finally { cleanup(root); }
});

test('parseSourceImports: only comments → no imports', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'comment.ts');
  fs.writeFileSync(file, '// import "foo";\n/* import "bar"; */', 'utf8');
  try {
    const imports = parseSourceImports(file, root);
    assert.deepEqual(imports, []);
  } finally { cleanup(root); }
});

test('parseSourceImports: export default → no import', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'default.ts');
  fs.writeFileSync(file, 'export default class Foo {}\n', 'utf8');
  try {
    const imports = parseSourceImports(file, root);
    assert.deepEqual(imports, []);
  } finally { cleanup(root); }
});

test('parseSourceImports: external package → null', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'ext.ts');
  fs.writeFileSync(file, "import * as React from 'react';\n", 'utf8');
  try {
    const imports = parseSourceImports(file, root);
    // 'react' is external → resolveSourceImport returns null → not in result
    assert.deepEqual(imports, []);
  } finally { cleanup(root); }
});

test('resolveSourceImport: non-existent file → null', () => {
  const { root } = createFixtureDir();
  const result = resolveSourceImport('./nope.ts', path.join(root, 'file.ts'), root);
  assert.equal(result, null);
});

test('resolveSourceImport: existing .ts with .js extension → resolves', () => {
  const { root } = createFixtureDir();
  fs.writeFileSync(path.join(root, 'dep.ts'), 'export const x = 1;\n', 'utf8');
  const result = resolveSourceImport('./dep.js', path.join(root, 'file.ts'), root);
  assert.equal(result, 'dep.ts');
});

test('getExportedSymbols: empty file → empty array', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'empty.ts');
  fs.writeFileSync(file, '', 'utf8');
  try {
    assert.deepEqual(getExportedSymbols(file), []);
  } finally { cleanup(root); }
});

test('getExportedSymbols: export default class', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'dc.ts');
  fs.writeFileSync(file, 'export default class MyClass {}\n', 'utf8');
  try {
    assert.deepEqual(getExportedSymbols(file), ['MyClass']);
  } finally { cleanup(root); }
});

test('getExportedSymbols: export default function', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'df.ts');
  fs.writeFileSync(file, 'export default function myFn() {}\n', 'utf8');
  try {
    assert.deepEqual(getExportedSymbols(file), ['myFn']);
  } finally { cleanup(root); }
});

test('getExportedSymbols: inline default', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'id.ts');
  fs.writeFileSync(file, 'export default 42;\n', 'utf8');
  try {
    // inline default has no name → should return empty
    assert.deepEqual(getExportedSymbols(file), []);
  } finally { cleanup(root); }
});

// ── Circular dependency graph ──

test('Module graph: simple A→B→C linear (no cycle)', () => {
  const { root } = createFixtureDir();
  fs.writeFileSync(path.join(root, 'a.ts'), "import './b.js';\n", 'utf8');
  fs.writeFileSync(path.join(root, 'b.ts'), "import './c.js';\n", 'utf8');
  fs.writeFileSync(path.join(root, 'c.ts'), 'export const c = 1;\n', 'utf8');
  try {
    const entries = walkSourceFiles(root);
    const g = new Map(entries.map(({ rel }) => [rel, new Set()]));
    for (const { file, rel } of entries) {
      for (const imp of parseSourceImports(file, root)) {
        g.get(rel)?.add(imp.path);
      }
    }
    // [P2 2026-08-06] 去副本直测：生产 buildModuleGraph + detectCycles（此前 inline 建图副本）
    const { moduleGraph } = buildModuleGraph(g);
    // [round80 P1] 根目录单层文件 getModule → 'src-root'（不再折叠进 core）；
    // a→b / b→c 同模块内边被丢弃，跨模块边集合恰为 ∅
    assert.deepEqual([...moduleGraph.keys()], ['src-root']);
    assert.deepEqual([...moduleGraph.get('src-root')], []);
    assert.deepEqual(detectCycles(moduleGraph), []);
  } finally { cleanup(root); }
});

test('Module graph: simple cross-module cycle A→B→A', () => {
  const { root } = createFixtureDir();
  fs.mkdirSync(path.join(root, 'a'));
  fs.mkdirSync(path.join(root, 'b'));
  fs.writeFileSync(path.join(root, 'a', 'index.ts'), "import '../b/index.js';\nexport const a = 1;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'b', 'index.ts'), "import '../a/index.js';\nexport const b = 1;\n", 'utf8');
  try {
    const entries = walkSourceFiles(root);
    const g = new Map(entries.map(({ rel }) => [rel, new Set()]));
    for (const { file, rel } of entries) {
      for (const imp of parseSourceImports(file, root)) {
        g.get(rel)?.add(imp.path);
      }
    }
    // [P2 2026-08-06] 去副本直测：生产 buildModuleGraph + detectCycles（此前 inline DFS 副本与生产同缺陷时给假绿）
    const { moduleGraph } = buildModuleGraph(g);
    // 具体边集合：跨模块边恰为 a→b 与 b→a 两条
    assert.deepEqual([...moduleGraph.keys()].sort(), ['a', 'b']);
    assert.deepEqual([...moduleGraph.get('a')], ['b']);
    assert.deepEqual([...moduleGraph.get('b')], ['a']);
    const cycles = detectCycles(moduleGraph);
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0], ['a', 'b', 'a']);
  } finally { cleanup(root); }
});

test('Module graph: self-import → no cycle (same module)', () => {
  const { root } = createFixtureDir();
  fs.mkdirSync(path.join(root, 'mod'));
  fs.writeFileSync(path.join(root, 'mod', 'a.ts'), "import './b.js';\nexport const a = 1;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'mod', 'b.ts'), "import './a.js';\nexport const b = 1;\n", 'utf8');
  try {
    const entries = walkSourceFiles(root);
    const g = new Map(entries.map(({ rel }) => [rel, new Set()]));
    for (const { file, rel } of entries) {
      for (const imp of parseSourceImports(file, root)) {
        g.get(rel)?.add(imp.path);
      }
    }
    // [P2 2026-08-06] 去副本直测：生产 buildModuleGraph + detectCycles（mod 模块内循环依赖不上跨模块图 → 无环）
    const { moduleGraph } = buildModuleGraph(g);
    assert.equal(moduleGraph.size, 1);
    assert.ok(moduleGraph.has('mod'));
    assert.equal(moduleGraph.get('mod').size, 0);
    assert.deepEqual(detectCycles(moduleGraph), []);
  } finally { cleanup(root); }
});

test('getModule: edge cases（直测生产真身）', () => {
  assert.equal(getModule('core/state.ts'), 'core');
  assert.equal(getModule('scene/physics/index.ts'), 'scene/physics');
  assert.equal(getModule('scene/index.ts'), 'scene');
  assert.equal(getModule('__tests__/test.ts'), 'test');
  assert.equal(getModule('utils.ts'), 'src-root'); // [round80 P1] 根文件独立成 src-root
  assert.equal(getModule('menus/index.ts'), 'menus');
});

// ── 补充边缘 ──

// [P1 2026-08-06] 钻石结构回归：旧 DFS 后向边算法只报回边指向栈内节点的环，
// a→b,b→a,a→c,c→b,c→a 会漏掉 3-环 a→c→b→a（cross edge c→b 被 visited 跳过）。
// 直测生产真身 detectCycles（已 export）。
test('detectCycles: 钻石结构不漏报 3-环（P1 回归）', () => {
  const graph = new Map([
    ['a', new Set(['b', 'c'])],
    ['b', new Set(['a'])],
    ['c', new Set(['b', 'a'])],
  ]);
  const cycles = detectCycles(graph);
  const keys = cycles.map((c) => c.join('→'));
  // 必须包含 3-环 a→c→b→a（旧算法只报 2-环 a→b→a 与 a→c→a）
  assert.ok(keys.includes('a→c→b→a'), `钻石结构应检出 3-环 a→c→b→a，实际: ${keys.join(', ')}`);
  // 且不丢失 2-环
  assert.ok(keys.includes('a→b→a'), `应含 2-环 a→b→a，实际: ${keys.join(', ')}`);
});

test('detectCycles: 简单 2-环 a→b→a', () => {
  const graph = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['a'])],
  ]);
  const cycles = detectCycles(graph);
  assert.ok(cycles.some((c) => c.join('→') === 'a→b→a'), JSON.stringify(cycles));
});

test('detectCycles: 无环图 → 空结果', () => {
  const graph = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['c'])],
    ['c', new Set()],
  ]);
  assert.deepEqual(detectCycles(graph), []);
});

test('Module graph: 3-node cycle A→B→C→A', () => {
  const { root } = createFixtureDir();
  fs.mkdirSync(path.join(root, 'a'));
  fs.mkdirSync(path.join(root, 'b'));
  fs.mkdirSync(path.join(root, 'c'));
  fs.writeFileSync(path.join(root, 'a', 'index.ts'), "import '../b/index.js';\nexport const a = 1;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'b', 'index.ts'), "import '../c/index.js';\nexport const b = 1;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'c', 'index.ts'), "import '../a/index.js';\nexport const c = 1;\n", 'utf8');
  try {
    const entries = walkSourceFiles(root);
    const g = new Map(entries.map(({ rel }) => [rel, new Set()]));
    for (const { file, rel } of entries) {
      for (const imp of parseSourceImports(file, root)) {
        g.get(rel)?.add(imp.path);
      }
    }
    // 直测生产真身：buildModuleGraph + detectCycles（此前内联 DFS 副本与生产同缺陷）
    const { moduleGraph } = buildModuleGraph(g);
    const cycles = detectCycles(moduleGraph);
    assert.ok(cycles.length >= 1);
    // Cycle should be a → b → c → a
    const first = cycles[0];
    assert.ok(first[0] === 'a' || first[0] === 'b' || first[0] === 'c');
    assert.equal(first.length, 4); // a → b → c → a
  } finally { cleanup(root); }
});

test('Module graph: isolated module (zero deps) → no edges', () => {
  const { root } = createFixtureDir();
  fs.mkdirSync(path.join(root, 'leaf'));
  fs.writeFileSync(path.join(root, 'leaf', 'solo.ts'), 'export const x = 1;\n', 'utf8');
  try {
    const entries = walkSourceFiles(root);
    const g = new Map(entries.map(({ rel }) => [rel, new Set()]));
    for (const { file, rel } of entries) {
      for (const imp of parseSourceImports(file, root)) {
        g.get(rel)?.add(imp.path);
      }
    }
    // [P2 2026-08-06] 去副本直测：生产 buildModuleGraph + detectCycles（此前 inline 建图副本与生产不同源）
    const { moduleGraph } = buildModuleGraph(g);
    assert.ok(moduleGraph.has('leaf'));
    assert.deepEqual([...moduleGraph.get('leaf')], []);
    assert.deepEqual(detectCycles(moduleGraph), []);
  } finally { cleanup(root); }
});

test('parseSourceImports: import with comment before', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'commented.ts');
  fs.writeFileSync(file, '// this is a comment\nimport "./real.js";\n', 'utf8');
  fs.writeFileSync(path.join(root, 'real.ts'), 'export const x = 1;\n', 'utf8');
  try {
    const imports = parseSourceImports(file, root);
    assert.equal(imports.length, 1);
    assert.equal(imports[0].path, 'real.ts');
  } finally { cleanup(root); }
});

test('parseSourceImports: import type before actual import', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'mixed-types.ts');
  fs.writeFileSync(file, 'import type "./types.js";\nimport "./real.js";\n', 'utf8');
  fs.writeFileSync(path.join(root, 'types.ts'), 'export type T = string;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'real.ts'), 'export const x = 1;\n', 'utf8');
  try {
    const imports = parseSourceImports(file, root);
    // type-only import should not appear in runtime graph
    assert.equal(imports.length, 1);
    assert.equal(imports[0].path, 'real.ts');
  } finally { cleanup(root); }
});

// ── [ADR-268] 环口径 = 加载期依赖；白名单 key = 节点集合 ──

test('parseSourceImports: includeDynamic=false 排除动态 import()', () => {
  const { root } = createFixtureDir();
  const file = path.join(root, 'dyn.ts');
  fs.writeFileSync(
    file,
    'import "./static.js";\nconst m = import("./lazy.js");\n',
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'static.ts'), 'export const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'lazy.ts'), 'export const b = 2;\n', 'utf8');
  try {
    const withDynamic = parseSourceImports(file, root);
    assert.deepEqual(withDynamic.map((i) => i.path).sort(), ['lazy.ts', 'static.ts']);

    const withoutDynamic = parseSourceImports(file, root, { includeDynamic: false });
    assert.deepEqual(withoutDynamic.map((i) => i.path), ['static.ts']);
  } finally { cleanup(root); }
});

test('cycleSetKey: 同一组节点的不同路径 → 同一个 key（白名单抗漂移）', () => {
  // 同一组节点 {a,b,c} 的三条路径变体（含旋转/反向起点）必须归一到同一 key
  const k1 = cycleSetKey(['a', 'b', 'c', 'a']);
  const k2 = cycleSetKey(['b', 'c', 'a', 'b']);
  const k3 = cycleSetKey(['c', 'a', 'b', 'c']);
  assert.equal(k1, k2);
  assert.equal(k2, k3);
  assert.equal(k1, 'a+b+c');
  // 对照：旧路径口径对同一组节点的**不同走法**给出不同 key —— 这正是假漂移的机制
  // （新增一条更短的边 → 代表环改走另一条路径 → 旧 key 再也匹配不上）
  assert.notEqual(normalizeCycleKey(['a', 'b', 'c', 'a']), normalizeCycleKey(['a', 'c', 'b', 'a']));
});

test('cycleSetKey: 不同节点集合 → 不同 key', () => {
  assert.notEqual(cycleSetKey(['a', 'b', 'a']), cycleSetKey(['a', 'b', 'c', 'a']));
});

test('representativeCycles: 归并键与 cycleSetKey 同源（白名单判定不会漏）', () => {
  const cycles = [
    ['a', 'b', 'a'],
    ['a', 'b', 'c', 'a'],
    ['c', 'a', 'b', 'c'], // 与上一条同节点集合 → 应被归并
  ];
  const reps = representativeCycles(cycles);
  // {a,b} 与 {a,b,c} 两组，各留最短环
  assert.equal(reps.length, 2);
  const setKeys = reps.map(cycleSetKey).sort();
  assert.deepEqual(setKeys, ['a+b', 'a+b+c']);
});

