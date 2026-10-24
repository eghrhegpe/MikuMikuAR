import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { toPosix, toNative } from './to-posix.mjs';

// ── toPosix ──

test('toPosix converts backslashes to forward slashes', () => {
  assert.equal(toPosix('a\\b\\c.ts'), 'a/b/c.ts');
});

test('toPosix leaves posix input unchanged', () => {
  assert.equal(toPosix('a/b/c.ts'), 'a/b/c.ts');
});

test('toPosix handles mixed separators', () => {
  assert.equal(toPosix('a\\b/c\\d.ts'), 'a/b/c/d.ts');
});

test('toPosix is idempotent', () => {
  assert.equal(toPosix(toPosix('a\\b\\c.ts')), 'a/b/c.ts');
});

test('toPosix handles empty string and trailing slash', () => {
  assert.equal(toPosix(''), '');
  assert.equal(toPosix('a\\b\\'), 'a/b/');
});

// ── toNative ──

// [round-77 #18] 按平台写死期望（to-posix.mjs:23 将 / 替换为 path.sep）：
// 原 split/join 现算期望与实现同构（自证 oracle，只验证可执行、不验证行为）。
const NATIVE_EXPECTED = path.sep === '\\' ? 'a\\b\\c.ts' : 'a/b/c.ts';

test('toNative converts forward slashes to platform separator', () => {
  assert.equal(toNative('a/b/c.ts'), NATIVE_EXPECTED);
});

test('toNative is inverse of toPosix on the same platform', () => {
  assert.equal(toNative(toPosix('a\\b\\c.ts')), NATIVE_EXPECTED);
});
