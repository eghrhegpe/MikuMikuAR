import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanSourceGraph, parseSourceImports } from './source-graph.mjs';

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

function createExportRenamedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'renamed.ts'), [
    "export { foo as bar } from './source.js';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'source.ts'), 'export const foo = 1;');
  return { root, srcDir };
}

function createMultiLineExportFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 're-export.ts'), [
    'export {',
    '  A,',
    '  B,',
    "} from './dep.ts';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'dep.ts'), 'export const A = 1; export const B = 2;');
  return { root, srcDir };
}

function createTypeInsideImportFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'user.ts'), [
    "import { type Foo } from './types.js';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'types.ts'), 'export interface Foo { x: number }');
  return { root, srcDir };
}

function createStringContextFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'test-file.ts'), [
    "import { real } from './actual.js';",
    'const str = "import(\'./fake-path.ts\')";',
    'const tmpl = `import(\'./other.ts\')`;',
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'actual.ts'), 'export const real = 1;');
  return { root, srcDir };
}

function createMultipleDynamicsFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'loader.ts'), [
    "const a = await import('./a.js');",
    "const b = await import('./b.js');",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'a.ts'), 'export const a = 1;');
  fs.writeFileSync(path.join(srcDir, 'b.ts'), 'export const b = 2;');
  return { root, srcDir };
}

function createMixedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'mixed.ts'), [
    "import './polyfill.js';",
    "export { helper } from './util.js';",
    "const lazy = await import('./heavy.js');",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'polyfill.ts'), '// side effect');
  fs.writeFileSync(path.join(srcDir, 'util.ts'), 'export const helper = true;');
  fs.writeFileSync(path.join(srcDir, 'heavy.ts'), 'export const heavy = true;');
  return { root, srcDir };
}

function createNonExistentImportFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miku-source-graph-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'file.ts'), [
    "import './real.js';",
    "import './i-dont-exist.js';",
  ].join('\n'));
  fs.writeFileSync(path.join(srcDir, 'real.ts'), 'export const real = 1;');
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

// ── 新增测试（第 2 批）：扩大解析器覆盖 ──

test('resolves export { foo as bar } renamed re-exports', () => {
  const fixture = createExportRenamedFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('renamed.ts')], ['source.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves multi-line export { } from statements', () => {
  const fixture = createMultiLineExportFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('re-export.ts')].sort(), ['dep.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves inline type imports like import { type X } from', () => {
  const fixture = createTypeInsideImportFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('user.ts')], ['types.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('does not match import() inside string literals or template literals', () => {
  const fixture = createStringContextFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('test-file.ts')], ['actual.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves multiple await import() in same file', () => {
  const fixture = createMultipleDynamicsFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('loader.ts')].sort(), ['a.ts', 'b.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('resolves mixed syntaxes in one file (side-effect + export from + await import)', () => {
  const fixture = createMixedFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('mixed.ts')].sort(), [
      'heavy.ts',
      'polyfill.ts',
      'util.ts',
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('ignores non-existent import paths gracefully', () => {
  const fixture = createNonExistentImportFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir);
    assert.deepEqual([...graph.get('file.ts')], ['real.ts']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
