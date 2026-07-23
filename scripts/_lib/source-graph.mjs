import fs from 'node:fs';
import path from 'node:path';

export const EXCLUDE_DIRS = new Set(['__tests__', '__mocks__', 'node_modules', 'wailsjs']);
export const EXCLUDE_FILES = [/\.d\.ts$/, /\.test\.tsx?$/, /\.spec\.tsx?$/, /\.gen\.tsx?$/];
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export function isSourceFile(name) {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext))
    && !EXCLUDE_FILES.some((re) => re.test(name));
}

export function shouldTraverseDir(name) {
  return !name.startsWith('.') && !EXCLUDE_DIRS.has(name);
}

export function walkSourceFiles(srcDir, dir = srcDir, base = '') {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (shouldTraverseDir(entry.name)) {
        entries.push(...walkSourceFiles(srcDir, full, rel));
      }
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      entries.push({ file: full, rel });
    }
  }

  return entries;
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
  return found ? path.relative(srcDir, found).replace(/\\/g, '/') : null;
}

export function parseSourceImports(filePath, srcDir) {
  const text = fs.readFileSync(filePath, 'utf8');
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
