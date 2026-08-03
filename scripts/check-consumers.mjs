#!/usr/bin/env node
/**
 * check-consumers.mjs
 * 符号反向查询 —— 给定一个导出符号（函数/类/接口/类型），列出 frontend/src/ 中
 * 所有 import 并消费它的文件与行号，帮助 AI 在重构前做「影响面预判」。
 *
 * 用法：
 *   node scripts/check-consumers.mjs <符号名>                 # 查询全部消费者
 *   node scripts/check-consumers.mjs <符号名> --json          # JSON 输出（供脚本/AI 消费）
 *   node scripts/check-consumers.mjs <符号名> --scope scene   # 只扫 scene/ 子模块
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
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  walkSourceFiles,
  resolveSourceImport,
  getExportedSymbols,
  SOURCE_EXTENSIONS,
} from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
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

// ── 主流程 ──

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['json'],
    strings: ['scope'],
  });

  const target = args._[0];
  if (!target) {
    console.error('用法: node scripts/check-consumers.mjs <符号名> [--json] [--scope <dir>]');
    process.exit(1);
  }

  const scope = args.scope;
  const allFiles = walkSourceFiles(SRC_DIR);
  const files = scope
    ? allFiles.filter((f) => f.rel.startsWith(scope + '/'))
    : allFiles;

  const defs = [];        // { rel, line, kind }
  const direct = [];      // { rel, line, text, kind, local }
  const namespaces = [];  // { rel, line, ns, usageLines }
  const reexports = [];   // { rel, line, text, kind }

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
        const nsTarget = path.join(SRC_DIR, stmt.resolved.replace(/\//g, path.sep));
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

  // ── 输出 ──
  if (args.json) {
    console.log(JSON.stringify({
      target,
      scope: scope || 'all',
      definitions: defs.map((d) => `${d.rel}:${d.line}`),
      directConsumers: direct.map((d) => ({ file: d.rel, line: d.line, kind: d.kind, used: d.used, usageLines: d.usageLines })),
      namespaceConsumers: namespaces.map((n) => ({ file: n.rel, line: n.line, ns: n.ns, usageLines: n.usageLines })),
      reexports: reexports.map((r) => ({ file: r.rel, line: r.line, kind: r.kind })),
    }, null, 2));
    return;
  }

  console.log(`🔍 consumers: ${target}${scope ? `（scope=${scope}）` : ''}\n`);

  if (defs.length > 0) {
    console.log(`📦 定义（${defs.length} 处）：`);
    for (const d of defs) console.log(`  ${d.rel}:${d.line}`);
  } else {
    console.log(`📦 定义：未在 frontend/src 内找到直接 export（可能是 re-export 链末端或外部符号）`);
  }

  const directUsed = direct.filter((d) => d.used);
  const directUnused = direct.filter((d) => !d.used);
  console.log(`\n⬅️ 直接 import 消费（${direct.length} 处，其中实际使用 ${directUsed.length}）：`);
  for (const d of direct) {
    const mark = d.used ? '' : '  ⚠️ 仅导入未使用';
    const kindTag = `[${d.kind}]`;
    console.log(`  ${d.rel}:${d.line}  ${kindTag} ${d.text}${mark}`);
    if (d.used && d.local !== target) {
      console.log(`      （本地别名 ${d.local}，使用行：${d.usageLines.join(', ')}）`);
    } else if (d.used) {
      console.log(`      使用行：${d.usageLines.join(', ')}`);
    }
  }

  if (namespaces.length > 0) {
    console.log(`\n🌐 命名空间消费（${namespaces.length} 处）：`);
    for (const n of namespaces) {
      console.log(`  ${n.rel}:${n.line}  import * as ${n.ns}  →  ${n.ns}.${target} 使用行：${n.usageLines.join(', ')}`);
    }
  }

  if (reexports.length > 0) {
    console.log(`\n↩️ 再导出中转（${reexports.length} 处，改动后需同步）：`);
    for (const r of reexports) {
      console.log(`  ${r.rel}:${r.line}  ${r.text}`);
    }
  }

  if (defs.length === 0 && direct.length === 0 && namespaces.length === 0 && reexports.length === 0) {
    console.log(`✅ 未找到任何引用 —— ${target} 是干净叶子，可安全重构`);
  } else {
    console.log(`\n结论：改动 ${target} 共影响 ${defs.length} 定义 + ${direct.length + namespaces.length} 消费 + ${reexports.length} 再导出。`);
  }
}

main();
