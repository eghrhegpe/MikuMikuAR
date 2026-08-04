#!/usr/bin/env node
/**
 * goerr-lint.mjs — Go 错误处理 lint 检查
 *
 * 设计意图：Go 错误处理 lint 检查
 *
 * 依赖：node:fs / node:url / node:path / 本地模块
 *
 * 用法：
 *   node scripts/goerr-lint.mjs                 # 默认行为
 *   node scripts/goerr-lint.mjs --strict # 启用 strict
 *
 * 退出码：0 / strict ? 1 : 0（含失败码）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { toPosix } from './_lib/to-posix.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const strict = process.argv.includes('--strict');

const HAN = /\p{Script=Han}/u;
const FRONTEND_ANTIPATTERN = /instanceof\s+Error\s*\?\s*[^;{}\n]*?\.message\s*:\s*String\(/;

const violations = [];

function walk(dir, onFile) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        const full = resolve(dir, name);
        let st;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
            walk(full, onFile);
        } else if (st.isFile()) {
            onFile(full);
        }
    }
}

function toRel(file) {
    return toPosix(relative(ROOT, file));
}

function checkGoFile(file) {
    if (!file.endsWith('.go')) return;
    const rel = toRel(file);
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
        if (/fmt\.Errorf\(/.test(line) && HAN.test(line)) {
            violations.push({
                side: 'Go',
                file: rel,
                line: i + 1,
                text: line.trim(),
                hint: '用 i18nerr.New(code, msg, params) 替代 fmt.Errorf 中文',
            });
        }
    });
}

function isFrontendSource(file) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return false;
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;
    const rel = toRel(file);
    if (!rel.startsWith('frontend/src/')) return false;
    if (rel.endsWith('core/i18n/goerr.ts')) return false; // 翻译器自身
    return true;
}

function checkFrontendFile(file) {
    const rel = toRel(file);
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
        if (FRONTEND_ANTIPATTERN.test(line)) {
            violations.push({
                side: 'FE',
                file: rel,
                line: i + 1,
                text: line.trim(),
                hint: '用 translateGoError(err) 替代 `instanceof Error ? err.message : String(err)`',
            });
        }
    });
}

walk(resolve(ROOT, 'internal', 'app'), checkGoFile);
walk(resolve(ROOT, 'frontend', 'src'), (file) => {
    if (isFrontendSource(file)) checkFrontendFile(file);
});

if (violations.length === 0) {
    console.log('✅ goerr-lint: 无 ADR-117 回归（internal/app 无 CJK fmt.Errorf；frontend 无 .message 直显反模式）');
    process.exit(0);
}

console.log(`\n⚠️  goerr-lint: 发现 ${violations.length} 处 ADR-117 潜在回归\n`);
for (const v of violations) {
    console.log(`  [${v.side}] ${v.file}:${v.line}`);
    console.log(`       ${v.text}`);
    console.log(`       ↳ ${v.hint}\n`);
}
console.log('说明：用户可见错误须经 i18nerr.New + translateGoError 走多语言翻译链路。');
console.log('      Go 端保留 errors.Is 语义的 util.WrapErrorf 中文格式串不在本检查范围。');
process.exit(strict ? 1 : 0);
