#!/usr/bin/env node
/**
 * check-assertion-baseline.mjs — 类型断言数量 ratchet（ADR-276 决策 5 的收尾物）
 *
 * 设计意图：
 *   ADR-276 决策 5 把 no-non-null-assertion 保持为 off，理由是「把规则翻成 warn
 *   等于把 900 条存量噪声合法化……噪声不是纪律」，同时留下收尾条件：
 *   「真正的 ratchet（基线文件 + 只许降不许升）留作本阶段收尾时的独立提案」。
 *   本脚本就是那把尺子，与 ESLint 分工：
 *     - ESLint（frontend/eslint.config.js:59 规则 off）：不做数量监督，只靠 review
 *       要求「新增非空断言必须写理由注释」；
 *     - 本门禁：只认总数，超过基线即阻断。新增 1 处就必须先还掉 1 处。
 *
 * 统计口径（AST，非正则——字符串与注释里的 `!` 不会误报）：
 *   nonNull       NonNullExpression（`foo!`、`foo!.bar`）。`let x!: T` 的定值断言
 *                 不是 NonNullExpression，不计入（与 eslint 规则口径一致）。
 *   doubleAssert  `x as unknown as T`：AsExpression 的表达式仍是 AsExpression
 *                 且内层类型为 unknown。ADR-277 教训 1 称其为「静音开关，不是逃生舱」。
 *   asAny         `x as any` / `<any>x`。ADR-101 验收标准是零新增。
 *   tsIgnore      @ts-ignore / @ts-expect-error / @ts-nocheck 注释（生产应为 0）。
 *   测试文件（*.test.* / *.spec.* / __tests__ 目录）不计入：ADR-276 已单列
 *   755 处测试存量并判定为可容忍（mock 的类型形状没必要严格）。
 *
 * 依赖：node:fs / node:path / node:url / node:module / typescript（从 frontend 解析）
 *
 * 用法：
 *   node scripts/check-assertion-baseline.mjs            # 检查（超基线退 1）
 *   node scripts/check-assertion-baseline.mjs --json     # 机器可读
 *   node scripts/check-assertion-baseline.mjs --update   # 收紧基线（只许降，不许升）
 *
 * 退出码：0 通过 / 1 回退（或 --update 试图上调）/ 2 用法或环境错误
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT as REPO_ROOT, walk } from './_lib/scan-files.mjs';

const FRONTEND = path.join(REPO_ROOT, 'frontend');
// 测试钩子：ASSERTION_SRC / ASSERTION_BASELINE 指向 fixture（真实运行不设）
const SRC_ROOT = process.env.ASSERTION_SRC
  ? path.resolve(process.env.ASSERTION_SRC)
  : path.join(FRONTEND, 'src');
const BASELINE_FILE = process.env.ASSERTION_BASELINE
  ? path.resolve(process.env.ASSERTION_BASELINE)
  : path.join(REPO_ROOT, 'docs', '.assertion-baseline.json');

const USAGE_ERROR = 2;
const REGRESSION = 1;

/** 四个指标的顺序即报告顺序 */
const METRICS = ['nonNull', 'doubleAssert', 'asAny', 'tsIgnore'];
const METRIC_LABEL = {
  nonNull: '非空断言 !',
  doubleAssert: 'as unknown as T',
  asAny: 'as any',
  tsIgnore: '@ts-ignore/@ts-expect-error',
};

const { json, update, help, unknown } = parseArgs(process.argv.slice(2), { bools: ['json', 'update'] });
if (help) {
  const src = fs.readFileSync(process.argv[1], 'utf-8');
  const s = src.indexOf('/**');
  const e = src.indexOf('*/', s);
  console.log(src.slice(s, e + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
if (unknown && unknown.length) {
  console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
  process.exit(USAGE_ERROR);
}

/* ---------- 解析 typescript（scripts/ 自身不装依赖，从 frontend 借） ---------- */
let ts;
try {
  ts = createRequire(path.join(FRONTEND, 'package.json'))('typescript');
} catch (e) {
  console.error(`[assertion] 无法从 frontend 解析 typescript: ${e.message}`);
  process.exit(USAGE_ERROR);
}

/* ---------- 统计 ---------- */
const SCAN_OPTS = {
  exts: ['.ts', '.tsx'],
  skipDir: (n) => n.startsWith('.') || n === 'node_modules' || n === '__tests__',
  skipFile: /\.(d|test|spec)\.tsx?$/,
};

function countFile(abs) {
  const text = fs.readFileSync(abs, 'utf-8');
  const kind = abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, kind);
  const c = { nonNull: 0, doubleAssert: 0, asAny: 0, tsIgnore: 0 };

  const visit = (n) => {
    if (n.kind === ts.SyntaxKind.NonNullExpression) {
      c.nonNull++;
    } else if (
      n.kind === ts.SyntaxKind.AsExpression ||
      n.kind === ts.SyntaxKind.TypeAssertionExpression
    ) {
      if (n.type && n.type.kind === ts.SyntaxKind.AnyKeyword) c.asAny++;
      // as unknown as T：外层 type 是目标类型，内层表达式才是 as unknown
      if (n.expression && n.expression.kind === ts.SyntaxKind.AsExpression) {
        const inner = n.expression.type;
        if (inner && inner.kind === ts.SyntaxKind.UnknownKeyword) c.doubleAssert++;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  // 抑制注释只认「指令形态」（注释体以 @ts-x 开头），正文里提到不算——
  // 正则直接扫全文会把 ADR 讨论、本脚本注释里的示例也数进来（测试 fixture 实测）。
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    kind === ts.ScriptKind.TSX ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text
  );
  for (let tok = scanner.scan(); tok !== ts.SyntaxKind.EndOfFileToken; tok = scanner.scan()) {
    if (tok !== ts.SyntaxKind.SingleLineCommentTrivia && tok !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const raw = text.slice(scanner.getTokenPos(), scanner.getTextPos());
    if (/^\/\/+?\s*@ts-(?:ignore|expect-error|nocheck)\b/.test(raw) || /^\/\*+\s*@ts-(?:ignore|expect-error|nocheck)\b/.test(raw)) {
      c.tsIgnore++;
    }
  }
  return c;
}

function scan() {
  const files = walk(SRC_ROOT, { ...SCAN_OPTS, rel: true });
  const totals = { nonNull: 0, doubleAssert: 0, asAny: 0, tsIgnore: 0 };
  const perFile = {};
  for (const { abs, rel } of files) {
    const c = countFile(abs);
    let any = false;
    for (const m of METRICS) {
      if (c[m] > 0) {
        totals[m] += c[m];
        any = true;
      }
    }
    if (any) perFile[rel.replace(/\\/g, '/')] = c;
  }
  return { totals, perFile, fileCount: files.length };
}

const { totals, perFile, fileCount } = scan();

/* ---------- 基线读写 ---------- */
function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
  } catch (e) {
    console.error(`[assertion] 基线文件无法解析: ${BASELINE_FILE}（${e.message}）`);
    process.exit(USAGE_ERROR);
  }
}

const baseline = loadBaseline();

/* ---------- --update：写基线，只许降 ---------- */
if (update) {
  if (baseline && baseline.totals) {
    const raised = METRICS.filter((m) => totals[m] > (baseline.totals[m] ?? 0));
    if (raised.length) {
      console.error('❌ 基线只许降不许升 —— 拒绝写入。');
      for (const m of raised) {
        console.error(
          `   ${METRIC_LABEL[m]}: 当前 ${totals[m]} > 基线 ${baseline.totals[m] ?? 0}（+${totals[m] - (baseline.totals[m] ?? 0)}）`
        );
      }
      console.error('   确属必要的上调须人工编辑 docs/.assertion-baseline.json 并写明理由（ADR-276）。');
      process.exit(REGRESSION);
    }
  }
  const payload = {
    _comment:
      'ADR-276 决策 5 的断言 ratchet 基线。totals 只许降不许升；新增非空断言 / as unknown as / as any / @ts-ignore 必须先还掉等量存量。更新: node scripts/check-assertion-baseline.mjs --update（拒绝上调）',
    generatedAt: new Date().toISOString().slice(0, 10),
    scope: 'frontend/src（不含 *.d.ts / *.test.* / *.spec.* / __tests__）',
    totals,
    perFile,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  console.log(`✅ 基线已写入 ${path.relative(REPO_ROOT, BASELINE_FILE)}`);
  for (const m of METRICS) console.log(`   ${METRIC_LABEL[m]}: ${totals[m]}`);
  process.exit(0);
}

/* ---------- 检查 ---------- */
if (!baseline || !baseline.totals) {
  // fail-closed：基线丢了就等于门禁默认放行，比没有门禁更危险
  console.error(`❌ [assertion] 基线文件缺失或格式不符: ${path.relative(REPO_ROOT, BASELINE_FILE)}`);
  console.error('   初始化: node scripts/check-assertion-baseline.mjs --update');
  process.exit(USAGE_ERROR);
}

const base = baseline.totals;
const regressions = [];
const improvements = [];
for (const m of METRICS) {
  const b = base[m] ?? 0;
  if (totals[m] > b) regressions.push({ metric: m, current: totals[m], baseline: b, delta: totals[m] - b });
  else if (totals[m] < b) improvements.push({ metric: m, current: totals[m], baseline: b, delta: b - totals[m] });
}

/** 找出总数上涨的落点：当前文件中超出基线同文件计数的（新建文件即 0→n） */
function blame(metric) {
  const bfile = (baseline && baseline.perFile) || {};
  const out = [];
  for (const [rel, c] of Object.entries(perFile)) {
    const before = bfile[rel] ? bfile[rel][metric] || 0 : 0;
    if (c[metric] > before) out.push({ file: rel, before, after: c[metric], delta: c[metric] - before });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

if (json) {
  console.log(
    JSON.stringify(
      {
        ok: regressions.length === 0,
        fileCount,
        totals,
        baseline: base,
        regressions,
        blame: Object.fromEntries(regressions.map((r) => [r.metric, blame(r.metric).slice(0, 20)])),
      },
      null,
      2
    )
  );
} else if (regressions.length === 0) {
  const tail = METRICS.map((m) => `${METRIC_LABEL[m]} ${totals[m]}/${base[m] ?? 0}`).join('，');
  console.log(`✅ [assertion] 断言基线未回退（${tail}；扫描 ${fileCount} 个文件）`);
  if (improvements.length) {
    console.log('🎉 存量已下降，可收紧基线（只许降）：');
    for (const i of improvements) console.log(`   ${METRIC_LABEL[i.metric]}: ${i.baseline} → ${i.current}（-${i.delta}）`);
    console.log('   运行 `node scripts/check-assertion-baseline.mjs --update`');
  }
} else {
  console.error('❌ [assertion] 断言数量超出基线（ADR-276 决策 5：只许降不许升）');
  for (const r of regressions) {
    console.error(`   ${METRIC_LABEL[r.metric]}: ${r.current} > 基线 ${r.baseline}（+${r.delta}）`);
    for (const b of blame(r.metric).slice(0, 5)) {
      console.error(`      ${b.file}: ${b.before} → ${b.after}（+${b.delta}）`);
    }
  }
  console.error('   改法（ADR-276 决策 1，只认三种）：① 收口访问器 requireX() ② 早返回收窄 ③ 签名放宽为 | undefined。');
  console.error('   禁止逐处新增 `!` 或 `as unknown as` 消化同类问题。');
}

process.exit(regressions.length === 0 ? 0 : REGRESSION);
