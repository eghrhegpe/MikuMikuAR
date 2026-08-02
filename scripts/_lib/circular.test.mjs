import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { walkSourceFiles, getExportedSymbols, parseSourceImports, resolveSourceImport } from './source-graph.mjs';

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
    const { files, graph } = { files: entries, graph: g };
    // Build module graph
    const moduleGraph = new Map();
    for (const [file, deps] of graph) {
      const mod = file.split('/')[0];
      if (!moduleGraph.has(mod)) moduleGraph.set(mod, new Set());
      for (const d of deps) {
        const dMod = d.split('/')[0];
        if (dMod !== mod) moduleGraph.get(mod).add(dMod);
      }
    }
    // A→B, B→C, no cross-module edges → no cycles expected
    // But since all files in root, they're all in 'root' module → no cross-module deps
    assert.ok(moduleGraph.size > 0);
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
    const { files, graph } = { files: entries, graph: g };

    const moduleGraph = new Map();
    for (const [file, deps] of graph) {
      const parts = file.split('/');
      const mod = parts.length > 0 ? parts[0] : 'root';
      if (!moduleGraph.has(mod)) moduleGraph.set(mod, new Set());
      for (const d of deps) {
        const dParts = d.split('/');
        const dMod = dParts.length > 0 ? dParts[0] : 'root';
        if (dMod !== mod) moduleGraph.get(mod).add(dMod);
      }
    }

    // Detect cycles via DFS
    const cycles = [];
    const visited = new Set();
    const inStack = new Set();
    const pathArr = [];
    function dfs(node) {
      if (inStack.has(node)) {
        const start = pathArr.indexOf(node);
        if (start !== -1) cycles.push([...pathArr.slice(start), node]);
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      pathArr.push(node);
      for (const dep of moduleGraph.get(node) || new Set()) dfs(dep);
      pathArr.pop();
      inStack.delete(node);
    }
    for (const n of moduleGraph.keys()) dfs(n);
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
    const { files, graph } = { files: entries, graph: g };

    const moduleGraph = new Map();
    for (const [file, deps] of graph) {
      const parts = file.split('/');
      const mod = parts.length > 0 ? parts[0] : 'root';
      if (!moduleGraph.has(mod)) moduleGraph.set(mod, new Set());
      for (const d of deps) {
        const dParts = d.split('/');
        const dMod = dParts.length > 0 ? dParts[0] : 'root';
        if (dMod !== mod) moduleGraph.get(mod).add(dMod);
      }
    }
    // All in 'mod' module → no cross-module deps → no cycles
    assert.ok(moduleGraph.size === 1);
    assert.ok(moduleGraph.get('mod').size === 0);
  } finally { cleanup(root); }
});

test('getModule: edge cases', () => {
  function getModule(rel) {
    const parts = rel.split('/');
    if (parts.length === 0) return 'unknown';
    const top = parts[0];
    if (top === '__tests__') return 'test';
    if (parts.length === 1) return 'core';
    if (top === 'scene' && parts.length > 2) return `scene/${parts[1]}`;
    return top;
  }

  assert.equal(getModule('core/state.ts'), 'core');
  assert.equal(getModule('scene/physics/index.ts'), 'scene/physics');
  assert.equal(getModule('scene/index.ts'), 'scene');
  assert.equal(getModule('__tests__/test.ts'), 'test');
  assert.equal(getModule('utils.ts'), 'core');
  assert.equal(getModule('menus/index.ts'), 'menus');
});

// ── 补充边缘 ──

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
    const moduleGraph = new Map();
    for (const [file, deps] of g) {
      const parts = file.split('/');
      const mod = parts.length > 0 ? parts[0] : 'root';
      if (!moduleGraph.has(mod)) moduleGraph.set(mod, new Set());
      for (const d of deps) {
        const dParts = d.split('/');
        const dMod = dParts.length > 0 ? dParts[0] : 'root';
        if (dMod !== mod) moduleGraph.get(mod).add(dMod);
      }
    }

    const cycles = [];
    const visited = new Set();
    const inStack = new Set();
    const pathArr = [];
    function dfs(node) {
      if (inStack.has(node)) {
        const start = pathArr.indexOf(node);
        if (start !== -1) cycles.push([...pathArr.slice(start), node]);
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      pathArr.push(node);
      for (const dep of moduleGraph.get(node) || new Set()) dfs(dep);
      pathArr.pop();
      inStack.delete(node);
    }
    for (const n of moduleGraph.keys()) dfs(n);
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
    const moduleGraph = new Map();
    for (const [file, deps] of g) {
      const parts = file.split('/');
      const mod = parts.length > 0 ? parts[0] : 'root';
      if (!moduleGraph.has(mod)) moduleGraph.set(mod, new Set());
      for (const d of deps) {
        const dParts = d.split('/');
        const dMod = dParts.length > 0 ? dParts[0] : 'root';
        if (dMod !== mod) moduleGraph.get(mod).add(dMod);
      }
    }
    assert.ok(moduleGraph.has('leaf'));
    assert.equal(moduleGraph.get('leaf').size, 0);
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
