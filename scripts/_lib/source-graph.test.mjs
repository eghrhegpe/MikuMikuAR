import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanSourceGraph } from './source-graph.mjs';

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(path.join(srcDir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'main.ts'), [
    "import './dep.js';",
    "import '@/alias.mjs';",
    "import type './types.js';",
    "import './nested/index.mjs';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'dep.ts'), 'export const dep = true;');
  fs.writeFileSync(path.join(srcDir, 'alias.ts'), 'export const alias = true;');
  fs.writeFileSync(path.join(srcDir, 'types.ts'), 'export type Type = string;');
  fs.writeFileSync(path.join(srcDir, 'nested', 'index.ts'), 'export const nested = true;');
  return { root, srcDir };
}

function createExportFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'barrel.ts'), [
    "export { foo } from './foo.js';",
    "export * from './star.ts';",
    "export * as ns from './ns.ts';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'foo.ts'), 'export const foo = 1;');
  fs.writeFileSync(path.join(srcDir, 'star.ts'), 'export const star = 2;');
  fs.writeFileSync(path.join(srcDir, 'ns.ts'), 'export const ns = 3;');
  return { root, srcDir };
}

function createDynamicFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'lazy.ts'), [
    "const mod = await import('./dynamic.js');",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'dynamic.ts'), 'export const dyn = true;');
  return { root, srcDir };
}

function createMultiLineFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'multiline.ts'), [
    'import {',
    '  X,',
    '  Y,',
    "} from './target.ts';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'target.ts'), 'export const X = 1; export const Y = 2;');
  return { root, srcDir };
}

function createSideEffectFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'app.ts'), [
    "import './polyfill.js';",
    "import './styles.ts';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'polyfill.ts'), '// side effect');
  fs.writeFileSync(path.join(srcDir, 'styles.ts'), '// side effect');
  return { root, srcDir };
}

function createCommentFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'real.ts'), [
    "import { real } from './actual.js';",
    "// import { fake } from './should-not-match.ts';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'actual.ts'), 'export const real = 1;');
  return { root, srcDir };
}

test('resolves TypeScript targets imported with JavaScript extensions', () => {
  const fixture = createFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('main.ts')].sort(), [
      'alias.ts',
      'dep.ts',
      'nested/index.ts',
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('does not include type-only imports', () => {
  const fixture = createFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.equal(graph.get('main.ts').has('types.ts'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves export {} from re-exports', () => {
  const fixture = createExportFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('barrel.ts')].sort(), [
      'foo.ts',
      'ns.ts',
      'star.ts',
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves await import() dynamic imports', () => {
  const fixture = createDynamicFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('lazy.ts')], ['dynamic.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves multi-line import statements', () => {
  const fixture = createMultiLineFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('multiline.ts')], ['target.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves side-effect imports without from', () => {
  const fixture = createSideEffectFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('app.ts')].sort(), [
      'polyfill.ts',
      'styles.ts',
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('does not match commented-out imports', () => {
  const fixture = createCommentFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('real.ts')], ['actual.ts']);
    assert.equal(graph.has('should-not-match.ts'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
