// [doc:adr-059] 检查源码中 t('...') 引用的 key 是否都有 bundle 覆盖
// 用法: npx tsx scripts/find-untranslated-keys.ts
// 零副作用，不改源码，不碰测试

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { zhCN } from '../src/core/i18n/locales/zh-CN';
import { en } from '../src/core/i18n/locales/en';

// ---- 递归扫描 src/ 下的 .ts 文件（跳过测试和 i18n 自身） ----
function walkDir(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
            files.push(...walkDir(fullPath));
        } else if (
            entry.endsWith('.ts') &&
            !entry.endsWith('.test.ts') &&
            !dir.includes('__tests__') &&
            !dir.includes('i18n')
        ) {
            files.push(fullPath);
        }
    }
    return files;
}

const root = join(import.meta.dirname, '..', 'src');
const srcFiles = walkDir(root);

// ---- 提取 t('...') 中的 key ----
const usedKeys = new Set<string>();
const dynamicCalls: string[] = [];

for (const file of srcFiles) {
    const content = readFileSync(file, 'utf-8');
    // 匹配 t('literal_key') 和 t("literal_key") — 必须独立标识符（非 createElement 等误匹配）
    for (const m of content.matchAll(/(?<![$\w])t\(['"]([^'"]+)['"]\s*(?:,|\))/g)) {
        usedKeys.add(m[1]);
    }
    // 检测可能的动态 key 调用（t() 参数不是字面量）
    // 只匹配独立标识符 t( 前缀（非 createElement / setTimeout 等中的 t）
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 忽略 import/export 行和注释行
        if (line.includes('import') || line.includes('//')) continue;
        // 查找独立标识符 t( 的出现（前面非字母/数字/$）
        const idx = line.search(/(?<![$\w])t\(/);
        if (idx === -1) continue;
        // 跳过已经有字面量 key 的 t() 调用
        const rest = line.slice(idx + 2);
        if (/^\s*['"]/.test(rest)) continue;
        // 剩下的 t() 调用可能是动态 key
        dynamicCalls.push(`  ${relative(root, file)}:${i + 1}  ${line.trim()}`);
    }
}

// ---- 收集所有 bundle key ----
const bundleKeys = new Set([...Object.keys(zhCN), ...Object.keys(en)]);

// ---- 找出源码引用但 bundle 缺失的 key ----
const missing = [...usedKeys].filter(k => !bundleKeys.has(k));

let exitCode = 0;

if (missing.length) {
    console.log(`❌ 源码引用了 ${missing.length} 个 key，但所有 bundle 均未覆盖:`);
    for (const k of missing) console.log(`   ${k}`);
    exitCode = 1;
} else {
    console.log('✅ 源码中所有 t() 字面量 key 都有对应 bundle 覆盖');
}

if (dynamicCalls.length) {
    console.log(`\n⚠️ 发现 ${dynamicCalls.length} 处动态 key 调用（grep 无法静态分析，需人工确认）:`);
    for (const d of dynamicCalls) console.log(d);
}

console.log(`\n统计: 扫描 ${srcFiles.length} 个源文件, ${usedKeys.size} 个 t() 字面量 key, ${bundleKeys.size} 个 bundle key`);
process.exit(exitCode);
