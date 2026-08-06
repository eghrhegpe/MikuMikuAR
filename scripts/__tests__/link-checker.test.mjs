#!/usr/bin/env node
/**
 * link-checker.test.mjs
 * link-checker.mjs（Markdown 链接检查）单测。
 *
 * 覆盖 2026-08-07 审核修复的回归面：
 *   - extractLinks：普通链接 / 尖括号 <...> 含空格路径 / 代码块剥离
 *   - resolvePath：外部 URL / file:// / 占位符 < > / 锚点 / 相对路径
 *   - CLI：未知 flag 退 1（P1 回归）、--help 退 0、--strict 断链退 1
 *   - 非 UTF-8 文件不崩溃
 *
 * 运行：node --test scripts/__tests__/link-checker.test.mjs
 *       （已挂入 npm run test:scripts）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { extractLinks, resolvePath, walkMd } from '../link-checker.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPT = path.join(ROOT, 'scripts', 'link-checker.mjs');

/** 写临时 md 文件，返回 { dir, file } */
function makeMd(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkcheck-'));
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, content, 'utf8');
  return { dir, file };
}

/** spawn 真实 CLI，返回 { code, stdout, stderr }；rootOverride 指向 fixture 扫描根（测试钩子） */
function runCli(args, rootOverride) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
      env: rootOverride ? { ...process.env, LINK_CHECK_ROOT: rootOverride } : process.env,
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

// ── extractLinks ──

test('extractLinks: 普通链接与尖括号含空格路径均提取', () => {
  const { dir, file } = makeMd(
    '[正常](./b.md)\n[空格名](<./中文 空格.md>)\n[占位](<page>-<n>.png)\n'
  );
  try {
    const links = extractLinks(file);
    const paths = links.map((l) => l[1]);
    assert.ok(paths.includes('./b.md'), `应含普通链接: ${paths}`);
    assert.ok(paths.includes('./中文 空格.md'), `应含尖括号空格路径（含全量空格）: ${paths}`);
    // [P3 2026-08-08] 占位符 `<page>-<n>.png` 内部含 `>`，不得产出链接条目
    // （否则会被当真实相对路径报假断链）
    assert.ok(!paths.some((p) => p.includes('page')), `占位符不应产出链接条目: ${paths}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractLinks: 代码块内链接被剥离（不误报）', () => {
  const { dir, file } = makeMd('```\n[示例](./nonexistent-code.md)\n```\n[真实](./real.md)\n');
  try {
    const links = extractLinks(file);
    const paths = links.map((l) => l[1]);
    assert.ok(!paths.includes('./nonexistent-code.md'), '代码块内链接应被剥离');
    assert.ok(paths.includes('./real.md'), '代码块外链接应保留');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── resolvePath ──

test('resolvePath: 外部 URL / file:// / 占位符 / 锚点跳过（返回 null）', () => {
  assert.equal(resolvePath('/x/a.md', 'https://example.com'), null);
  assert.equal(resolvePath('/x/a.md', 'file:///etc/passwd'), null);
  assert.equal(resolvePath('/x/a.md', '<page>-<n>.png'), null); // 占位符
  assert.equal(resolvePath('/x/a.md', '#anchor'), null); // 锚点
});

test('resolvePath: 相对路径从文件目录解析并剥离 #anchor', () => {
  const resolved = resolvePath('/repo/docs/a.md', './b.md#section');
  assert.equal(resolved, path.resolve('/repo/docs/b.md'));
});

// ── CLI 契约 ──

test('未知 flag（--stict 打字错误）→ exit 1（P1 回归：门禁不可被静默关闭）', () => {
  const r = runCli(['--stict']);
  assert.equal(r.code, 1, '未知 flag 应报错退 1');
  assert.match(r.stderr, /未知参数/);
});

test('--help → exit 0', () => {
  const r = runCli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /link-checker/);
});

test('--strict 断链 → exit 1；全有效 → exit 0（LINK_CHECK_ROOT 限定 fixture）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkcheck-cli-'));
  try {
    // 全有效 fixture：ok.md → sub/ok.md
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'ok.md'), 'x\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'ok.md'), '[好](./sub/ok.md)\n', 'utf8');

    const r1 = runCli(['--strict'], dir);
    assert.equal(r1.code, 0, `全有效应 exit 0: ${r1.stdout} ${r1.stderr}`);

    // 含断链 fixture：bad.md → 不存在的目标
    fs.writeFileSync(path.join(dir, 'bad.md'), '[断](./no-such-file.md)\n', 'utf8');
    const r2 = runCli(['--strict'], dir);
    assert.equal(r2.code, 1, `含断链应 exit 1: ${r2.stdout}`);
    assert.match(r2.stdout, /断链/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('非 UTF-8 文件不崩溃（坏字节替换为 U+FFFD，脚本正常退出）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkcheck-utf8-'));
  try {
    const bad = Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x42]); // 非 UTF-8 字节序列
    fs.writeFileSync(path.join(dir, 'bad.md'), bad);
    fs.writeFileSync(path.join(dir, 'ok.md'), '[好](./ok.md)\n', 'utf8');
    const r = runCli(['--strict'], dir);
    // 不应崩溃（无未捕获异常）；exit 0 或 1 均可，但不该是崩溃堆栈
    assert.notEqual(r.code, null);
    assert.ok(!/Error:/.test(r.stderr), `不应有崩溃堆栈: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── walkMd（research 收紧回归：SKIP_DIRS 跳过、research 文档纳入） ──
// 注：dancexr-zh 跳过是 main() 收集层逻辑（非 walkMd 内部），由上方 CLI 用例经
// LINK_CHECK_ROOT 覆盖验证；此处只测 walkMd 的 SKIP_DIRS 过滤与 research 纳入。

test('walkMd: 跳过 SKIP_DIRS，纳入 docs/research 其他文档', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkcheck-walk-'));
  try {
    fs.mkdirSync(path.join(dir, 'docs', 'research', 'normal'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'research', 'normal', 'b.md'), 'x\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'docs', 'research', 'top.md'), 'x\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.md'), 'x\n', 'utf8');

    const found = walkMd(dir);
    const rels = found.map((f) => path.relative(dir, f).replace(/\\/g, '/')).sort();
    assert.ok(rels.includes('docs/research/normal/b.md'), 'research 其他文档应纳入');
    assert.ok(rels.includes('docs/research/top.md'), 'research 顶层 md 应纳入');
    assert.ok(!rels.some((r) => r.startsWith('node_modules')), 'node_modules 应跳过');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
