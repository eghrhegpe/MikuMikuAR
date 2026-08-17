import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { run, runSafe } from './proc.mjs';

// proc.mjs 契约测试：成功 / ENOENT / 超时 / 退出码 / cwd / env / runSafe。
// 全部用 node 作被测二进制，保证 Windows + POSIX 双平台可跑。

test('run success returns ok true with stdout', () => {
  const r = run('node', ['-e', 'console.log("hello")']);
  assert.equal(r.ok, true);
  assert.equal(r.rc, 0);
  assert.equal(r.out.trim(), 'hello');
});

test('run nonexistent binary returns rc -1 (ENOENT)', () => {
  const r = run('__definitely_not_a_real_bin__', ['--x']);
  assert.equal(r.ok, false);
  assert.equal(r.rc, -1);
  assert.match(r.err, /command not found/);
});

test('run timeout returns rc -2 and marks timed out (regression: e.killed 不可靠，改判 ETIMEDOUT)', () => {
  const r = run('node', ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.rc, -2);
  assert.match(r.err, /timed out after 300ms/);
});

test('run nonzero exit without allowExit1 fails', () => {
  const r = run('node', ['-e', 'process.exit(3)']);
  assert.equal(r.ok, false);
  assert.equal(r.rc, 3);
});

test('run exit 1 with allowExit1 treated as success', () => {
  const r = run('node', ['-e', 'process.exit(1)'], { allowExit1: true });
  assert.equal(r.ok, true);
  assert.equal(r.rc, 1);
});

test('run respects cwd for relative path resolution', () => {
  const dir = os.tmpdir();
  const r = run('node', ['-e', 'console.log(process.cwd())'], { cwd: dir });
  assert.equal(r.ok, true);
  assert.equal(r.out.trim(), path.resolve(dir));
});

test('run merges env into child process', () => {
  const r = run('node', ['-e', 'console.log(process.env.PROC_TEST_KEY)'], { env: { PROC_TEST_KEY: 'val-42' } });
  assert.equal(r.ok, true);
  assert.equal(r.out.trim(), 'val-42');
});

test('runSafe returns stdout on success', () => {
  const out = runSafe('node', ['-e', 'console.log("safe-ok")']);
  assert.equal(out.trim(), 'safe-ok');
});

test('runSafe returns empty string on failure', () => {
  const out = runSafe('__definitely_not_a_real_bin__', ['--x']);
  assert.equal(out, '');
});
