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
  const re = /^\s*import\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let match;

  while ((match = re.exec(text))) {
    const resolved = resolveSourceImport(match[2], filePath, srcDir);
    if (resolved) {
      imports.push({ path: resolved, isTypeOnly: Boolean(match[1]) });
    }
  }

  return imports;
}

export function scanSourceGraph(srcDir, { scope = null, includeTypeOnly = true } = {}) {
  const files = walkSourceFiles(srcDir);
  const selected = scope ? files.filter(({ rel }) => rel.startsWith(`${scope}/`)) : files;
  const graph = new Map(selected.map(({ rel }) => [rel, new Set()]));

  for (const { file, rel } of selected) {
    for (const imported of parseSourceImports(file, srcDir)) {
      if (includeTypeOnly || !imported.isTypeOnly) {
        graph.get(rel).add(imported.path);
      }
    }
  }

  return { files: selected, graph };
}
