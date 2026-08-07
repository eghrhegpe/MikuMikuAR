#!/usr/bin/env node
/**
 * check-cli.smoke.test.mjs
 * 顶层分析脚本冒烟测试 —— 防止「AI 的眼睛」悄悄坏掉。
 *
 * 策略：spawn 真实 CLI（非 import 内部函数），断言：
 *   1. 进程能跑完（exit 0）
 *   2. 输出含关键标识（符号名 / 标题行）
 *   3. 无未捕获错误（stderr 不含 ❌ / Error 崩溃）
 *
 * 刻意不硬编码行号/环数 —— 内容会随重构漂移，冒烟只验证「脚本活着」。
 * 覆盖：check-consumers（含 --json / --snapshot / --diff 快照闭环）
 *        check-circular（含 --edges / --snapshot / --diff 快照闭环）
 *
 * 运行：node --test scripts/check-cli.smoke.test.mjs
 *       （已挂入 npm run test:scripts）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPTS = path.join(ROOT, 'scripts');

/** spawn 脚本，返回 { code, stdout, stderr } */
function runScript(scriptName, args = []) {
  const result = { code: 0, stdout: '', stderr: '' };
  try {
    result.stdout = execFileSync(process.execPath, [scriptName, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
    });
  } catch (e) {
    result.code = e.status ?? 1;
    result.stdout = e.stdout?.toString() ?? '';
    result.stderr = e.stderr?.toString() ?? '';
  }
  return result;
}

// ── check-consumers 冒烟 ──

test('check-consumers: FootLandEvent 查询跑通且含定义', () => {
  const r = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /FootLandEvent/);
  assert.match(r.stdout, /motion-algos\/feet-event\.ts/); // ADR-238 Phase 1 下沉点
  assert.doesNotMatch(r.stderr, /Error|❌/);
});

test('check-consumers: --json 输出合法且含 definitions', () => {
  const r = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent', '--json']);
  assert.equal(r.code, 0);
  const data = JSON.parse(r.stdout);
  assert.ok(Array.isArray(data.definitions));
  assert.ok(data.definitions.some((d) => d.includes('feet-event')));
});

test('check-consumers: --snapshot → --diff 闭环自身无变化', () => {
  const snap = path.join(os.tmpdir(), `consumers-smoke-${process.pid}.json`);
  try {
    const s = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent', '--snapshot', snap]);
    assert.equal(s.code, 0, s.stderr);
    assert.ok(fs.existsSync(snap), '快照文件应生成');

    const d = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['FootLandEvent', '--diff', snap]);
    assert.equal(d.code, 0, d.stderr);
    assert.match(d.stdout, /无变化|结论：\+/);
  } finally {
    try { fs.rmSync(snap, { force: true }); } catch {}
  }
});

test('check-consumers: 未命中符号 → 干净叶子提示（exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-consumers.mjs'), ['__SmokeNoSuchSymbol_9x__']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /未找到任何引用|干净叶子/);
});

// ── check-circular 冒烟 ──

test('check-circular: 扫描跑通且输出模块数', () => {
  const r = runScript(path.join(SCRIPTS, 'check-circular.mjs'));
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /扫描到 \d+ 个模块/);
});

test('check-circular: --edges 归因输出可解析', () => {
  const r = runScript(path.join(SCRIPTS, 'check-circular.mjs'), ['--edges']);
  assert.equal(r.code, 0);
  // 有环时输出环路径；无环时输出 ✅。两者都算脚本健康
  assert.ok(/扫描到|✅ 未检测到|→/.test(r.stdout));
});

test('check-circular: --snapshot → --diff 闭环自身无新增环', () => {
  const snap = path.join(os.tmpdir(), `circular-smoke-${process.pid}.json`);
  try {
    const s = runScript(path.join(SCRIPTS, 'check-circular.mjs'), ['--snapshot', snap]);
    assert.equal(s.code, 0, s.stderr);
    assert.ok(fs.existsSync(snap), '快照文件应生成');

    const d = runScript(path.join(SCRIPTS, 'check-circular.mjs'), ['--diff', snap]);
    assert.equal(d.code, 0, d.stderr);
    assert.match(d.stdout, /基线快照|无新增环/);
  } finally {
    try { fs.rmSync(snap, { force: true }); } catch {}
  }
});

// ── check-adr-status 冒烟（R1/R2 修复回归：退出码契约 + 入链） ──

test('check-adr-status: 语料全部可分类 → exit 0（R1 修复：unknown>0 才非零）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-adr-status.mjs'), ['--json']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  const data = JSON.parse(r.stdout);
  assert.ok(typeof data.stats === 'object', 'JSON 应含 stats');
  assert.equal(data.stats.unknown, 0, '当前语料应无 unknown 状态');
});

test('check-adr-status: --help 退 0 且含用法', () => {
  const r = runScript(path.join(SCRIPTS, 'check-adr-status.mjs'), ['--help']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /check-adr-status/);
});

// ── gen-knowledge-symbols 冒烟（P2 修复回归：Go 分组/Java 告警不阻断正常路径） ──

test('gen-knowledge-symbols: --check 跑通且语义一致（Go 分组符号增量同步后应无漂移）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-knowledge-symbols.mjs'), ['--check']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /与源码导出符号一致|漂移/);
});

// ── check-adr-technical-debt 冒烟（P1 回归：list 格式状态行不再漏检） ──

test('check-adr-technical-debt: --json 含 ADR-149（list 格式漏检回归）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-adr-technical-debt.mjs'), ['--json']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  const data = JSON.parse(r.stdout);
  assert.ok(Array.isArray(data.debtItems), 'JSON 应含 debtItems 数组');
  assert.ok(
    data.debtItems.some((i) => i.includes('adr-149')),
    `ADR-149（- **状态** 列表格式）应被检出，实际: ${data.debtItems.slice(0, 3).join(' | ')}`
  );
});

// ── gen-knowledge-adr 冒烟（P2 回归：带后缀/合并标记 + Go 卡 sources） ──

test('gen-knowledge-adr: --check 通过（P2-3 修复后 Go/backend 卡 adr 已补全 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-knowledge-adr.mjs'), ['--check']);
  // P2-3 修复后 Go 卡 sources 不再被 frontend/ 前缀排除，pre-commit 钩子已补全其 adr 字段；
  // 断言稳态：全部 architecture 卡均已登记（此前 6 张 Go 卡缺口已被消化）
  assert.equal(r.code, 0, `应 exit 0: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout + r.stderr, /所有 architecture 卡均已登记 adr 关联/);
});

// ── gen-tier 冒烟（P2-1 回归：占位符卡 writeTier 不产生重复键） ──

test('gen-tier: --check 跑通（当前稳态全卡已标 tier → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-tier.mjs'), ['--check']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /未标 tier 卡: 0|全部知识卡已标 tier/);
});

// ── check-schema-groups 冒烟（P2 回归：--help 必崩 + group 值校验不误报） ──

test('check-schema-groups: --help 退 0 且含用法（P2 回归：fs 未绑定必崩）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-schema-groups.mjs'), ['--help']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /check-schema-groups/);
});

test('check-schema-groups: --strict 跑通（当前 schema 无缺 group / 无非法 group 值 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-schema-groups.mjs'), ['--strict']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /所有字段均有 group|Schema group 完整性/);
});

// ── gen-knowledge-tests 冒烟（P2 回归：非 frontend tests 条目保守跳过 + 收口共享库） ──

test('gen-knowledge-tests: --check 跑通（225 测试文件登记无漂移 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-knowledge-tests.mjs'), ['--check']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /所有有测试文件的卡均已登记 tests/);
});

// ── gen-routes 冒烟（P2 回归：NON_CARDS/frontmatter 收口共享库后行为一致） ──

test('gen-routes: --check 跑通（收口共享库后 routes.md 无漂移 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-routes.mjs'), ['--check']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /已同步/);
});

// ── check-boolean-naming 冒烟（P1/P2 回归：--help 必崩 + 字段数自校验不误报） ──

test('check-boolean-naming: --help 退 0 且含用法（P1 回归：fs 未绑定必崩）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-boolean-naming.mjs'), ['--help']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /check-boolean-naming/);
});

test('check-boolean-naming: --strict 跑通（当前 25 布尔字段全合规 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-boolean-naming.mjs'), ['--strict']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /boolean 字段总数: 25|Boolean 字段命名检查/);
});

// ── check-env-parity 冒烟（P1/P2 回归：--help 必崩 + 双空集守卫不误报） ──

test('check-env-parity: --help 退 0 且含用法（P1 回归：fs 未绑定必崩）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-env-parity.mjs'), ['--help']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /check-env-parity/);
});

test('check-env-parity: --strict 跑通（当前 schema↔bindings parity 成立 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-env-parity.mjs'), ['--strict']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /EnvState 字段 parity|parity 一致/);
});

// ── gen-dep-graph 冒烟（P2 回归：目录缺失守卫 + 排序确定性） ──

test('gen-dep-graph: 默认输出跑通（frontend/src 存在 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-dep-graph.mjs'));
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr}`);
  assert.match(r.stdout, /```mermaid/);
});

// ── gen-guide-gap 冒烟（P1 回归：camelCase 面板提取 + 覆盖判定） ──

test('gen-guide-gap: --strict 跑通（34 面板全提取、无缺口 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-guide-gap.mjs'), ['--strict']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /菜单 folder 面板: 34 个/);
  assert.match(r.stdout, /所有菜单面板均有 guide 页面覆盖/);
});

// ── gen-menu-map 冒烟（P2 回归：label 限定顶层 / 守卫空数组 / 对象映射路由） ──

test('gen-menu-map: --check 跑通（P2 修复后产物无 string 误报 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'gen-menu-map.mjs'), ['--check']);
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /一致|已同步/);
});

// ── check-deadcode-baseline 冒烟（P1/P2 回归：正常路径 exit 0） ──

test('check-deadcode-baseline: 正常路径跑通（knip/jscpd 可用、基线内 → exit 0）', () => {
  const r = runScript(path.join(SCRIPTS, 'check-deadcode-baseline.mjs'));
  assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
  assert.match(r.stdout, /未回退/);
});
