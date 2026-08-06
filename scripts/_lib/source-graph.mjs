import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './to-posix.mjs';
import { walk } from './scan-files.mjs';

export const EXCLUDE_DIRS = new Set(['__tests__', '__mocks__', 'node_modules', 'wailsjs', 'bindings', 'dist']);
export const EXCLUDE_FILES = [/\.d\.ts$/, /\.test\.tsx?$/, /\.spec\.tsx?$/, /\.gen\.tsx?$/];
/** 默认源码扩展名（含 .tsx + 存量 .js/.jsx，ADR-014 混编期两者并存）；gen-funcmap 等用 .ts-only 时传 ['ts'] */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export function isSourceFile(name, extensions = SOURCE_EXTENSIONS) {
  return extensions.some((ext) => name.endsWith(ext))
    && !EXCLUDE_FILES.some((re) => re.test(name));
}

export function shouldTraverseDir(name) {
  return !name.startsWith('.') && !EXCLUDE_DIRS.has(name);
}

export function walkSourceFiles(srcDir, dir = srcDir, base = '', extensions = SOURCE_EXTENSIONS) {
  return walk(dir, {
    exts: extensions,
    skipDir: (name) => !shouldTraverseDir(name),
    skipFile: (name) => EXCLUDE_FILES.some((re) => re.test(name)),
    rel: true,
    base,
  }).map(({ abs, rel }) => ({ file: abs, rel }));
}

function stripImportExtension(spec) {
  const extension = path.extname(spec).toLowerCase();
  return IMPORT_EXTENSIONS.includes(extension) ? spec.slice(0, -extension.length) : spec;
}

function resolveCandidates(basePath) {
  const normalized = stripImportExtension(basePath);
  return [
    ...SOURCE_EXTENSIONS.map((ext) => normalized + ext),
    ...SOURCE_EXTENSIONS.map((ext) => path.join(normalized, `index${ext}`)),
  ];
}

export function resolveSourceImport(spec, importerFile, srcDir) {
  let basePath;
  if (spec.startsWith('@/')) {
    basePath = path.join(srcDir, spec.slice(2));
  } else if (spec.startsWith('.')) {
    basePath = path.resolve(path.dirname(importerFile), spec);
  } else {
    return null;
  }

  const found = resolveCandidates(basePath).find((candidate) => fs.existsSync(candidate));
  return found ? toPosix(path.relative(srcDir, found)) : null;
}

export function parseSourceImports(filePath, srcDir) {
  // [P2 2026-08-06] 剥离块注释：`/* */` 内的独立行 import 字样此前被正则误识别为真 import
  // → 假边 → 假环（check-circular 门禁误报）。非换行字符替换为空格，保持行锚定 (?:^|\n) 不破坏。
  const text = fs.readFileSync(filePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const imports = [];
  const specs = new Set();

  // 正则 A: import / export ... from '...'（跨行，支持 import type / export {}/*/as ns）
  const reFrom = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*(?:import|export)\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  // 正则 B: import '...'（纯 side-effect，无 from）
  const reSide = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*import\s+['"]([^'"]+)['"]/gm;
  // 正则 C: await import('...') — 任意位置（不要求行首）
  const reDyna = /await\s+import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

  for (const re of [reFrom, reSide, reDyna]) {
    let match;
    while ((match = re.exec(text))) {
      const spec = match[1];
      if (!specs.has(spec)) {
        specs.add(spec);
        const resolved = resolveSourceImport(spec, filePath, srcDir);
        if (resolved) {
          imports.push({ path: resolved, isTypeOnly: false });
        }
      }
    }
  }

  return imports;
}

export function scanSourceGraph(srcDir, { scope = null, localOnly = false } = {}) {
  // 始终扫描全部文件构建全量图
  const files = walkSourceFiles(srcDir);
  const graph = new Map(files.map(({ rel }) => [rel, new Set()]));

  for (const { file, rel } of files) {
    for (const imported of parseSourceImports(file, srcDir)) {
      graph.get(rel).add(imported.path);
    }
  }

  // scope 过滤
  if (!scope) return { files, graph };

  const scopeSet = new Set(files.filter(({ rel }) => rel.startsWith(`${scope}/`)).map((f) => f.rel));

  if (localOnly) {
    // localOnly: 只保留 scope 内节点，不展开依赖
    const localGraph = new Map();
    for (const rel of scopeSet) {
      if (graph.has(rel)) {
        localGraph.set(rel, new Set([...graph.get(rel)].filter((d) => scopeSet.has(d))));
      }
    }
    return { files: [...scopeSet].sort().map((rel) => ({ file: path.join(srcDir, rel), rel })), graph: localGraph };
  }

  // 默认 scope 模式：递归展开所有可达依赖
  const visited = new Set();
  const reachable = new Set();
  function walk(node) {
    if (visited.has(node)) return;
    visited.add(node);
    reachable.add(node);
    const deps = graph.get(node);
    if (deps) for (const dep of deps) walk(dep);
  }
  for (const rel of scopeSet) walk(rel);

  const scopedGraph = new Map();
  for (const rel of reachable) {
    if (graph.has(rel)) {
      scopedGraph.set(rel, new Set([...graph.get(rel)].filter((d) => reachable.has(d))));
    }
  }
  const scopedFiles = [...reachable].sort().map((rel) => ({ file: path.join(srcDir, rel), rel }));

  return { files: scopedFiles, graph: scopedGraph };
}

// ── 导出符号提取（gen-funcmap / check-doc-drift 共用） ──

/**
 * 提取文件中的 export 符号列表。
 * 覆盖：export function/const/let/class/interface/type/enum/default、export { a, b }。
 */
export function getExportedSymbols(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const syms = new Set();

  // export async function / function / const / let / class / interface / type / enum
  // [P2 2026-08-06] re1 兼容 generator：`export async function* parseSseStream` 此前漏提，
  // 导致 core/ai/sse.ts 整文件缺席 function-map（实证）。function 与 * 之间允许可选星号。
  const re1 = /^export\s+(?:async\s+)?(?:function\s*\*?|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;
  let m;
  while ((m = re1.exec(text))) syms.add(m[1]);

  // export { a, b, c } / export { a as b } / export type { X }（本地再导出，check-consumers resolved 校验依赖）
  const re2 = /^export\s*(?:type\s+)?\{([^}]+)\}/gm;
  while ((m = re2.exec(text))) {
    m[1].split(',').forEach((s) => {
      const name = s.trim().split(/\s+as\s+/).pop().trim();
      if (name && /^[A-Za-z0-9_]+$/.test(name)) syms.add(name);
    });
  }

  // export default function/class Name
  const re3 = /^export\s+default\s+(?:function|class)\s+([A-Za-z0-9_]+)/gm;
  while ((m = re3.exec(text))) syms.add(m[1]);

  // export default Name (inline)
  const re4 = /^export\s+default\s+([A-Za-z0-9_]+)\s*$/gm;
  while ((m = re4.exec(text))) syms.add(m[1]);

  return [...syms].sort();
}
