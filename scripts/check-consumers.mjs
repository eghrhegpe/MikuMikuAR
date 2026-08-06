#!/usr/bin/env node
/**
 * check-consumers.mjs — 符号反向查询 —— 给定一个导出符号（函数/类/接口/类型），列出 frontend/src/ 中
 * 符号反向查询 —— 给定一个导出符号（函数/类/接口/类型），列出 frontend/src/ 中
 * 所有 import 并消费它的文件与行号，帮助 AI 在重构前做「影响面预判」。
 *
 * 用法：
 *   node scripts/check-consumers.mjs <符号名>                 # 查询全部消费者
 *   node scripts/check-consumers.mjs <符号名> --json          # JSON 输出（供脚本/AI 消费）
 *   node scripts/check-consumers.mjs <符号名> --scope scene   # 只扫 scene/ 子模块
 *   node scripts/check-consumers.mjs <符号名> --snapshot <file> # 存消费者基线（重构前）
 *   node scripts/check-consumers.mjs <符号名> --diff <file>     # 对比基线：🟢消失/🔴新增/定义迁移
 *
 * 前后信息闭环：重构前 --snapshot 存基线 → 重构后 --diff 对比，
 * 精确回答「影响面扩大还是收敛、哪些消费者消失了」。
 *
 * 注意：--scope 会同时限制「定义」与「消费者」的扫描范围，查全量影响面时勿带此参数。
 *
 * 输出分类：
 *   📦 定义      —— getExportedSymbols 命中（含 re-export 中转站）
 *   ⬅️ 直接消费  —— import { Foo } / import type { Foo } / import Foo（default）
 *   🌐 命名空间  —— import * as ns 且 ns.Foo 实际出现
 *   ↩️ 再导出    —— export { Foo } from / export * from
 *
 * 零依赖（仅 node:fs / node:path）。符号匹配区分大小写。
 * 设计意图：符号消费者审计（重构影响面分析）
 * 退出码：2 / 1（含失败码）
 * check-consumers.mjs — 符号消费者审计（重构影响面分析）
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  walkSourceFiles,
  resolveSourceImport,
  getExportedSymbols,
  SOURCE_EXTENSIONS,
} from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { toNative } from './_lib/to-posix.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const SRC_DIR = path.join(ROOT, 'frontend', 'src');

// ── import 语句解析（符号级） ──

/**
 * 解析单个文件的 import/export-from 语句块。
 * @returns {Array<{line:number, text:string, spec:string, kind:'named'|'type'|'default'|'namespace'|'reexport'|'reexport-all', symbols:Array<{src:string, local:string}>|null, ns:string|null}>}
 */
function parseImportStatements(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const stmts = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const startsImport = /^(import|export)\b/.test(trimmed) && /from\s+['"]|import\s+['"]|export\s+\*\s+from/.test(trimmed);
    const startsExportFrom = /^export\s*\{/.test(trimmed) || /^export\s+(type\s+)?\{/.test(trimmed);

    if (startsImport || startsExportFrom) {
      // 收集语句块（支持跨行，直到 from '...' 或 import '...' 结束）
      const startLine = i;
      const blockLines = [];
      let block = '';
      while (i < lines.length) {
        blockLines.push(lines[i]);
        block += lines[i] + '\n';
        if (/from\s+['"][^'"]+['"]\s*[;]?\s*$/.test(lines[i].trim())
          || /^import\s+['"][^'"]+['"]\s*[;]?\s*$/.test(lines[i].trim())
          || /}\s+from\s+['"][^'"]+['"]\s*[;]?\s*$/.test(lines[i].trim())) {
          i++;
          break;
        }
        i++;
      }
      const stmt = parseStatement(block, startLine + 1, filePath);
      if (stmt) stmts.push(stmt);
      continue;
    }
    i++;
  }

  return stmts;
}

/** 解析单个语句块文本 → 结构化描述 */
function parseStatement(block, line, filePath) {
  const text = block.trim();
  const specMatch = /from\s+['"]([^'"]+)['"]/.exec(text);
  const spec = specMatch ? specMatch[1] : null;
  const resolved = spec ? resolveSourceImport(spec, filePath, SRC_DIR) : null;

  // import '...' 纯副作用
  if (/^import\s+['"]/.test(text)) {
    return { line, text: text.slice(0, 80), spec, resolved, kind: 'side-effect', symbols: null, ns: null };
  }

  // export * from
  if (/^export\s+\*\s+from/.test(text)) {
    return { line, text: text.slice(0, 80), spec, resolved, kind: 'reexport-all', symbols: null, ns: null };
  }

  // import * as ns
  const nsMatch = /^import\s+(?:type\s+)?\*\s+as\s+([A-Za-z0-9_]+)/.exec(text);
  if (nsMatch) {
    return { line, text: text.slice(0, 80), spec, resolved, kind: 'namespace', symbols: null, ns: nsMatch[1] };
  }

  // import Default, { A, B as C } | import { A } | import type { A }
  const bodyMatch = /^import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?\{([^}]*)\}/.exec(text);
  const isTypeOnly = /^import\s+type\s+/.test(text);
  if (bodyMatch) {
    const symbols = [];
    if (bodyMatch[1]) symbols.push({ src: bodyMatch[1], local: bodyMatch[1] }); // default
    for (const raw of bodyMatch[2].split(',')) {
      const parts = raw.trim().split(/\s+as\s+/);
      if (!parts[0]) continue;
      const src = parts[0].trim();
      const local = parts[1] ? parts[1].trim() : src;
      if (src && /^[A-Za-z0-9_]+$/.test(src)) symbols.push({ src, local });
    }
    return { line, text: text.slice(0, 80), spec, resolved, kind: isTypeOnly ? 'type' : 'named', symbols, ns: null };
  }

  // import Default from（无花括号）
  const defMatch = /^import\s+(?:type\s+)?(\w+)\s+from/.exec(text);
  if (defMatch) {
    return {
      line, text: text.slice(0, 80), spec, resolved,
      kind: /^import\s+type\s+/.test(text) ? 'type' : 'default',
      symbols: [{ src: defMatch[1], local: defMatch[1] }], ns: null,
    };
  }

  // export { A, B as C } from
  const expMatch = /^export\s+(?:type\s+)?\{([^}]*)\}\s+from/.exec(text);
  if (expMatch) {
    const symbols = [];
    for (const raw of expMatch[1].split(',')) {
      const parts = raw.trim().split(/\s+as\s+/);
      if (!parts[0]) continue;
      const src = parts[0].trim();
      const local = parts[1] ? parts[1].trim() : src;
      if (src && /^[A-Za-z0-9_]+$/.test(src)) symbols.push({ src, local });
    }
    return { line, text: text.slice(0, 80), spec, resolved, kind: 'reexport', symbols, ns: null };
  }

  return null;
}

// ── 符号使用行定位 ──

/** 统计 local 名在文件中出现（不含 import 块本身）的行号 */
function findUsageLines(filePath, localName, excludeFromLine) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const re = new RegExp(`\\b${localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const hits = [];
  for (let idx = 0; idx < lines.length; idx++) {
    if (idx + 1 === excludeFromLine) continue; // 跳过 import 语句起始行（其余跨行由正则天然不命中）
    if (re.test(lines[idx])) hits.push(idx + 1);
  }
  return hits.slice(0, 12); // 行号上限 12，防刷屏
}

// ── 消费者扫描（可复用：查询 / 快照 / diff 共用） ──

/**
 * 扫描 target 的全部消费者信息。
 * @returns {{defs:Array, direct:Array, namespaces:Array, reexports:Array}}
 */
function collectConsumers(target, files) {
  const defs = [];
  const direct = [];
  const namespaces = [];
  const reexports = [];

  // 1. 定义扫描（含 re-export 中转）。行号定位：单行 export 声明 → 多行 export { 块起始行 → 符号首现行
  for (const { file, rel } of files) {
    const syms = getExportedSymbols(file);
    if (!syms.includes(target)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const reSym = new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    let line = lines.findIndex((l) => /^export\b/.test(l) && reSym.test(l));
    if (line === -1) {
      // 多行 export { ... } 块：找块起始行，符号出现在块闭合前的行区间内
      for (let idx = 0; idx < lines.length; idx++) {
        if (/^export\s*(?:type\s+)?\{/.test(lines[idx])) {
          let j = idx;
          while (j < lines.length && !lines[j].includes('}')) {
            if (reSym.test(lines[j])) { line = idx; break; }
            j++;
          }
          if (line !== -1) break;
        }
      }
    }
    if (line === -1) {
      // 兜底：符号首现行
      line = lines.findIndex((l) => reSym.test(l));
    }
    defs.push({ rel, line: line + 1 || 1 });
  }

  // 2. 消费者扫描
  for (const { file, rel } of files) {
    let stmts;
    try {
      stmts = parseImportStatements(file);
    } catch {
      continue;
    }
    for (const stmt of stmts) {
      if (!stmt.spec) continue;

      if (stmt.kind === 'namespace') {
        // namespace：解析模块导出含 target 且 ns.target 实际出现才计
        if (!stmt.resolved) continue;
        const nsTarget = path.join(SRC_DIR, toNative(stmt.resolved));
        if (!fs.existsSync(nsTarget)) continue;
        if (!getExportedSymbols(nsTarget).includes(target)) continue;
        const usageRe = new RegExp(`\\b${stmt.ns}\\.${target}\\b`);
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        const usageLines = [];
        for (let idx = 0; idx < lines.length; idx++) {
          if (usageRe.test(lines[idx])) usageLines.push(idx + 1);
        }
        if (usageLines.length > 0) {
          namespaces.push({ rel, line: stmt.line, ns: stmt.ns, usageLines: usageLines.slice(0, 8) });
        }
        continue;
      }

      if (!stmt.symbols) continue;
      const hit = stmt.symbols.find((s) => s.src === target);
      if (!hit) continue;

      if (stmt.kind === 'reexport' || stmt.kind === 'reexport-all') {
        reexports.push({ rel, line: stmt.line, text: stmt.text, kind: stmt.kind });
      } else {
        const usageLines = findUsageLines(file, hit.local, stmt.line);
        direct.push({
          rel, line: stmt.line, text: stmt.text,
          kind: stmt.kind === 'type' ? 'type-only' : (stmt.kind === 'default' ? 'default' : 'named'),
          local: hit.local,
          used: usageLines.length > 0,
          usageLines: usageLines.slice(0, 6),
        });
      }
    }
  }

  return { defs, direct, namespaces, reexports };
}

// ── 快照 / 对比（--snapshot / --diff） ──

/** 消费者条目稳定 key（rel + line + 类型区分），用于 diff 比对 */
function directKey(d) { return `${d.rel}:${d.line}:${d.kind}`; }
function nsKey(n) { return `${n.rel}:${n.line}:ns.${n.ns}`; }
function reKey(r) { return `${r.rel}:${r.line}:${r.kind}`; }

function saveConsumerSnapshot(snapshotPath, target, c) {
  const data = {
    $comment: '符号消费者基线快照。由 check-consumers.mjs --snapshot 生成，供 --diff 对比。',
    updatedAt: new Date().toISOString().slice(0, 10),
    target,
    definitions: c.defs.map((d) => `${d.rel}:${d.line}`),
    direct: c.direct.map((d) => ({ rel: d.rel, line: d.line, kind: d.kind, text: d.text, used: d.used })),
    namespaces: c.namespaces.map((n) => ({ rel: n.rel, line: n.line, ns: n.ns })),
    reexports: c.reexports.map((r) => ({ rel: r.rel, line: r.line, kind: r.kind })),
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✅ 快照已保存：${target} → ${path.relative(ROOT, snapshotPath)}`);
}

function loadConsumerSnapshot(snapshotPath) {
  if (!fs.existsSync(snapshotPath)) {
    console.error(`❌ 快照文件不存在：${snapshotPath}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
}

/** 对比当前消费者与基线快照：🟢 消失 / 🔴 新增 / 🟡 保留 */
function diffConsumers(snapshotPath, target, c) {
  const base = loadConsumerSnapshot(snapshotPath);
  if (base.target && base.target !== target) {
    console.warn(`⚠️ 快照符号 ${base.target} ≠ 命令行符号 ${target}，对比结果无意义。`);
  }

  const curDefs = new Set(c.defs.map((d) => `${d.rel}:${d.line}`));
  const baseDefs = new Set(base.definitions || []);
  const defAdded = [...curDefs].filter((k) => !baseDefs.has(k));
  const defRemoved = [...baseDefs].filter((k) => !curDefs.has(k));

  const curDirect = new Map(c.direct.map((d) => [directKey(d), d]));
  const baseDirect = new Map((base.direct || []).map((d) => [directKey(d), d]));
  const directAdded = [...curDirect.values()].filter((d) => !baseDirect.has(directKey(d)));
  const directRemoved = [...baseDirect.values()].filter((d) => !curDirect.has(directKey(d)));

  const curNs = new Map(c.namespaces.map((n) => [nsKey(n), n]));
  const baseNs = new Map((base.namespaces || []).map((n) => [nsKey(n), n]));
  const nsAdded = [...curNs.values()].filter((n) => !baseNs.has(nsKey(n)));
  const nsRemoved = [...baseNs.values()].filter((n) => !curNs.has(nsKey(n)));

  const curRe = new Map(c.reexports.map((r) => [reKey(r), r]));
  const baseRe = new Map((base.reexports || []).map((r) => [reKey(r), r]));
  const reAdded = [...curRe.values()].filter((r) => !baseRe.has(reKey(r)));
  const reRemoved = [...baseRe.values()].filter((r) => !curRe.has(reKey(r)));

  const totalBase = baseDirect.size + baseNs.size + baseRe.size + baseDefs.size;
  const totalCur = curDirect.size + curNs.size + curRe.size + curDefs.size;
  const addedCount = directAdded.length + nsAdded.length + reAdded.length + defAdded.length;
  const removedCount = directRemoved.length + nsRemoved.length + reRemoved.length + defRemoved.length;

  console.log(`🔍 diff: ${target}（基线 ${totalBase} → 当前 ${totalCur}）\n`);

  if (defRemoved.length > 0) {
    console.log(`📦 定义消失（${defRemoved.length}）：`);
    for (const k of defRemoved) console.log(`  ${k}`);
  }
  if (defAdded.length > 0) {
    console.log(`\n📦 定义新增（${defAdded.length}）：`);
    for (const k of defAdded) console.log(`  ${k}`);
  }

  if (directRemoved.length > 0) {
    console.log(`\n🟢 消费消失（${directRemoved.length}）：`);
    for (const d of directRemoved) console.log(`  ${d.rel}:${d.line}  [${d.kind}] ${d.text || ''}`);
  }
  if (directAdded.length > 0) {
    console.log(`\n🔴 消费新增（${directAdded.length}）：`);
    for (const d of directAdded) console.log(`  ${d.rel}:${d.line}  [${d.kind}] ${d.text || ''}`);
  }

  if (nsRemoved.length > 0) {
    console.log(`\n🟢 命名空间消失（${nsRemoved.length}）：`);
    for (const n of nsRemoved) console.log(`  ${n.rel}:${n.line}  import * as ${n.ns}`);
  }
  if (nsAdded.length > 0) {
    console.log(`\n🔴 命名空间新增（${nsAdded.length}）：`);
    for (const n of nsAdded) console.log(`  ${n.rel}:${n.line}  import * as ${n.ns} → ${n.ns}.${target}`);
  }

  if (reRemoved.length > 0) {
    console.log(`\n🟢 再导出消失（${reRemoved.length}）：`);
    for (const r of reRemoved) console.log(`  ${r.rel}:${r.line}  [${r.kind}]`);
  }
  if (reAdded.length > 0) {
    console.log(`\n🔴 再导出新增（${reAdded.length}）：`);
    for (const r of reAdded) console.log(`  ${r.rel}:${r.line}  [${r.kind}]`);
  }

  if (addedCount === 0 && removedCount === 0) {
    console.log('✅ 消费者清单无变化');
  } else {
    console.log(`\n结论：+${addedCount} / -${removedCount}。`);
    if (addedCount > 0) console.log('  ⚠️ 新增消费者说明影响面扩大，重构需覆盖新引用。');
  }
}

// ── 主流程 ──

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['json'],
    strings: ['scope', 'snapshot', 'diff'],
  });

  const target = args._[0];
  const snapshot = args.snapshot;
  const diff = args.diff;
  if (!target) {
    console.error('用法: node scripts/check-consumers.mjs <符号名> [--json] [--scope <dir>] [--snapshot <file>] [--diff <file>]');
    process.exit(1);
  }

  const scope = args.scope;
  const allFiles = walkSourceFiles(SRC_DIR);
  const files = scope
    ? allFiles.filter((f) => f.rel.startsWith(scope + '/'))
    : allFiles;

  const c = collectConsumers(target, files);

  if (snapshot) {
    saveConsumerSnapshot(snapshot, target, c);
    return;
  }
  if (diff) {
    diffConsumers(diff, target, c);
    return;
  }
  // ── 输出 ──
  if (args.json) {
    console.log(JSON.stringify({
      target,
      scope: scope || 'all',
      definitions: c.defs.map((d) => `${d.rel}:${d.line}`),
      directConsumers: c.direct.map((d) => ({ file: d.rel, line: d.line, kind: d.kind, used: d.used, usageLines: d.usageLines })),
      namespaceConsumers: c.namespaces.map((n) => ({ file: n.rel, line: n.line, ns: n.ns, usageLines: n.usageLines })),
      reexports: c.reexports.map((r) => ({ file: r.rel, line: r.line, kind: r.kind })),
    }, null, 2));
    return;
  }

  console.log(`🔍 consumers: ${target}${scope ? `（scope=${scope}）` : ''}\n`);

  if (c.defs.length > 0) {
    console.log(`📦 定义（${c.defs.length} 处）：`);
    for (const d of c.defs) console.log(`  ${d.rel}:${d.line}`);
  } else {
    console.log(`📦 定义：未在 frontend/src 内找到直接 export（可能是 re-export 链末端或外部符号）`);
  }

  const directUsed = c.direct.filter((d) => d.used);
  const directUnused = c.direct.filter((d) => !d.used);
  console.log(`\n⬅️ 直接 import 消费（${c.direct.length} 处，其中实际使用 ${directUsed.length}）：`);
  for (const d of c.direct) {
    const mark = d.used ? '' : '  ⚠️ 仅导入未使用';
    const kindTag = `[${d.kind}]`;
    console.log(`  ${d.rel}:${d.line}  ${kindTag} ${d.text}${mark}`);
    if (d.used && d.local !== target) {
      console.log(`      （本地别名 ${d.local}，使用行：${d.usageLines.join(', ')}）`);
    } else if (d.used) {
      console.log(`      使用行：${d.usageLines.join(', ')}`);
    }
  }

  if (c.namespaces.length > 0) {
    console.log(`\n🌐 命名空间消费（${c.namespaces.length} 处）：`);
    for (const n of c.namespaces) {
      console.log(`  ${n.rel}:${n.line}  import * as ${n.ns}  →  ${n.ns}.${target} 使用行：${n.usageLines.join(', ')}`);
    }
  }

  if (c.reexports.length > 0) {
    console.log(`\n↩️ 再导出中转（${c.reexports.length} 处，改动后需同步）：`);
    for (const r of c.reexports) {
      console.log(`  ${r.rel}:${r.line}  ${r.text}`);
    }
  }

  if (c.defs.length === 0 && c.direct.length === 0 && c.namespaces.length === 0 && c.reexports.length === 0) {
    console.log(`✅ 未找到任何引用 —— ${target} 是干净叶子，可安全重构`);
  } else {
    console.log(`\n结论：改动 ${target} 共影响 ${c.defs.length} 定义 + ${c.direct.length + c.namespaces.length} 消费 + ${c.reexports.length} 再导出。`);
  }
}

main();
