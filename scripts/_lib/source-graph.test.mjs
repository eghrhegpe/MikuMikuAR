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

test('resolves TypeScript targets imported with JavaScript extensions', () => {
  const fixture = createFixture();
  try {
    const { graph } = scanSourceGraph(fixture.srcDir, { includeTypeOnly: false });
    assert.deepEqual([...graph.get('main.ts')].sort(), [
      'alias.ts',
      'dep.ts',
      'nested/index.ts',
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('can retain or exclude type-only imports explicitly', () => {
  const fixture = createFixture();
  try {
    const withTypes = scanSourceGraph(fixture.srcDir, { includeTypeOnly: true }).graph;
    const withoutTypes = scanSourceGraph(fixture.srcDir, { includeTypeOnly: false }).graph;
    assert.equal(withTypes.get('main.ts').has('types.ts'), true);
    assert.equal(withoutTypes.get('main.ts').has('types.ts'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
