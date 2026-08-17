import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './to-posix.mjs';
import { walk } from './scan-files.mjs';
import { scanImportSpecs, isTypeOnlyBody } from './import-scan.mjs';

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

export function parseSourceImports(filePath, srcDir, { includeDynamic = true } = {}) {
  // [fix 2026-10-23] 旧实现用正则先剥块注释再匹配 import：行注释里的 `→ scene/*` / `**/*.ts`
  // 会被当作块注释起点，惰性吞到下一个真 `*/`，跨过的真 import 行整行被置空 → 边丢失（假阴性）。
  // 该盲区使 dep-metrics / check-circular / check-layering 的图指标全部只是下界，
  // 见 docs/buglog/2026-10-23-source-graph-line-comment-swallow-edges.md。
  // 现改用 _lib/import-scan.mjs 的线性状态机：单遍遍历同时跳过行/块注释与字符串字面量，
  // 无跨语句回溯，结构上不可能出现「注释吞边」。
  //
  // [ADR-268] includeDynamic=false 时剔除 `import('…')` 动态边，供「加载期循环」口径使用：
  // 动态 import 是惰性求值，永不产生部分初始化模块的 undefined 绑定（最多挂起），
  // 因此不构成 ESM 求值期循环。静态/副作用 import 恒保留。
  const text = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  const specs = new Set();

  // [fix 2026-10-23] 口径统一：`import type { … } from 'x'` 是编译期擦除的类型引用，
  // 不产生任何运行时代码，与 check-layering 的 `isTypeOnlyBody` 豁免口径一致。
  // 此前本函数只信 scanImportSpecs 的 `typeOnly` 字段（它仅在 kind==='dynamic' 时被赋值），
  // 且把 `isTypeOnly: false` 硬编码，导致 257 条类型边被计入耦合图：
  // 虚构 8 个模块级有向对、3 个双向密耦对，并把 core/types.ts 的
  // `import type { ProcMotionState } from '@/motion-algos/procedural-motion'`
  // 记成 core 反向依赖算法层（R2 反向边 + 双向密耦对证据）。
  for (const { spec, typeOnly, kind, body } of scanImportSpecs(text)) {
    // 类型位置的动态 import（`x: import('m').T`）不构成运行时耦合，与 ADR-242 门禁口径一致
    if (typeOnly) continue;
    // 静态 `import type` / 具名项全带 type 前缀 → 运行时零成本，剔除
    if (kind === 'from' && isTypeOnlyBody(body)) continue;
    if (!includeDynamic && kind === 'dynamic') continue;
    if (specs.has(spec)) continue;
    specs.add(spec);
    const resolved = resolveSourceImport(spec, filePath, srcDir);
    if (resolved) {
      imports.push({ path: resolved, isTypeOnly: false });
    }
  }

  return imports;
}

export function scanSourceGraph(srcDir, { scope = null, localOnly = false, includeDynamic = true } = {}) {
  // 始终扫描全部文件构建全量图
  const files = walkSourceFiles(srcDir);
  const graph = new Map(files.map(({ rel }) => [rel, new Set()]));

  for (const { file, rel } of files) {
    for (const imported of parseSourceImports(file, srcDir, { includeDynamic })) {
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
