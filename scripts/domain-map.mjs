#!/usr/bin/env node
/**
 * domain-map.mjs — 文件路径数组 → 领域分类 JSON + 缓存支持。
 *
 * 设计意图：
 *   pre-push 细粒度分流入口，供 .githooks/pre-push 调用，
 *   以 JSON 形式输出变更文件所属的领域（docs/frontend/go/infra/mixed）。
 *
 * 用法：
 *   node scripts/domain-map.mjs <file1> <file2> ...          # 正常模式
 *   node scripts/domain-map.mjs --cache-key <domain> <files>  # 生成缓存键
 *   node scripts/domain-map.mjs --cache-path <key>           # 获取缓存路径
 *   node scripts/domain-map.mjs --cache-clear                # 清除所有缓存
 *
 * 缓存设计：
 *   - 缓存位置：~/.cache/mikimikuar/pre-push/<domain>/<hash>
 *   - 缓存键：domain + 文件列表的 MD5 哈希
 *   - 缓存值：{ result, timestamp, output }
 *   - 有效期：24h
 *
 * 输出：JSON 到 stdout
 * { "docs": bool, "frontend": bool, "go": bool, "infra": bool, "mixed": bool }
 *
 * 退出码：0 成功；1 无入参或内部错误。
 * 零依赖（仅 node:path / node:crypto / node:fs / node:os）。
 */

import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

// ── 领域模式定义 ────────────────────────────────────────────────
const RULES = [
  { domain: 'docs', test: (p) => /^docs\/.+\.md$/i.test(p) },
  { domain: 'frontend', test: (p) => /^frontend\/src\/.+?\.(ts|tsx|js|jsx)$/i.test(p) },
  { domain: 'go', test: (p) => /^internal\/.+\.go$/i.test(p) },
  { domain: 'infra', test: (p) => /^\.github\/.+?\.(yml|yaml)$/i.test(p) },
];

// ── 缓存工具函数 ───────────────────────────────────────────────
const CACHE_DIR = path.join(os.homedir(), '.cache', 'mikimikuar', 'pre-push');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

/**
 * 生成缓存键：domain + 文件列表 → MD5 hash
 */
export function cacheKey(domain, files) {
  const hash = crypto.createHash('md5');
  hash.update(domain);
  // 排序确保顺序不影响结果
  [...files].sort().forEach(f => hash.update(f));
  return hash.digest('hex');
}

/**
 * 获取缓存文件路径
 */
export function cachePath(key) {
  return path.join(CACHE_DIR, key);
}

/**
 * 读取缓存（若过期返回 null）
 */
export function readCache(key) {
  const cacheFile = cachePath(key);
  try {
    if (!fs.existsSync(cacheFile)) return null;
    const stat = fs.statSync(cacheFile);
    const now = Date.now();
    // 检查是否过期
    if (now - stat.mtimeMs > CACHE_TTL) {
      fs.unlinkSync(cacheFile); // 清理过期缓存
      return null;
    }
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    return data;
  } catch {
    return null;
  }
}

/**
 * 写入缓存
 */
export function writeCache(key, result) {
  const cacheFile = cachePath(key);
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const data = {
      result,
      timestamp: Date.now(),
    };
    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`[cache] 写入失败: ${e.message}`);
    return false;
  }
}

/**
 * 清除所有缓存
 */
export function clearCache() {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      fs.rmSync(CACHE_DIR, { recursive: true, force: true });
      console.log('[cache] 缓存已清除');
    } else {
      console.log('[cache] 缓存目录不存在');
    }
  } catch (e) {
    console.error(`[cache] 清除失败: ${e.message}`);
  }
}

// ── 主逻辑 ─────────────────────────────────────────────────────
function classifyDomain(files) {
  if (!files || files.length === 0) {
    return null;
  }

  const flags = {
    docs: false,
    frontend: false,
    go: false,
    infra: false,
  };

  for (const raw of files) {
    if (!raw || raw.trim() === '') continue;
    const p = raw.trim();

    for (const rule of RULES) {
      if (rule.test(p)) {
        flags[rule.domain] = true;
        break;
      }
    }
  }

  const total = Object.values(flags).filter(Boolean).length;
  flags.mixed = total !== 1;

  return flags;
}

// ── CLI 入口（仅当直接执行时运行）────────────────────────────
// 检测方式：检查是否通过 node scripts/domain-map.mjs 直接调用
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('domain-map.mjs') ||
  process.argv[1].replace(/\\/g, '/').endsWith('domain-map.mjs')
);
if (isMainModule) {
const args = process.argv.slice(2);

// --cache-clear 模式
if (args[0] === '--cache-clear') {
  clearCache();
  process.exit(0);
}

// --cache-key 模式
if (args[0] === '--cache-key') {
  if (args.length < 3) {
    console.error('usage: node scripts/domain-map.mjs --cache-key <domain> <file1> <file2> ...');
    process.exit(1);
  }
  const domain = args[1];
  const files = args.slice(2);
  const key = cacheKey(domain, files);
  console.log(key);
  process.exit(0);
}

// --cache-path 模式
if (args[0] === '--cache-path') {
  if (args.length !== 2) {
    console.error('usage: node scripts/domain-map.mjs --cache-path <key>');
    process.exit(1);
  }
  const key = args[1];
  console.log(cachePath(key));
  process.exit(0);
}

// 正常模式：分类文件
if (args.length === 0) {
  console.error('usage: node scripts/domain-map.mjs <file1> <file2> ...');
  console.error('       node scripts/domain-map.mjs --cache-key <domain> <files>');
  console.error('       node scripts/domain-map.mjs --cache-path <key>');
  console.error('       node scripts/domain-map.mjs --cache-clear');
  process.exit(1);
}

const result = classifyDomain(args);
if (result === null) {
  console.error('domain-map: 无可分类文件');
  process.exit(1);
}

process.stdout.write(JSON.stringify(result) + '\n');
} // end CLI guard
