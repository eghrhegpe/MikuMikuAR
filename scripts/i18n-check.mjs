#!/usr/bin/env node
// scripts/i18n-check.mjs — ADR-059 §3.5 / ADR-041 i18n bundle key 奇偶校验
//
// 校验翻译 bundle（ja/ko/zh-TW…）的 key 集合与基准（zh-CN）对齐，
// 防止新增 key 时翻译 bundle 静默漏翻（t.ts 回退链会兜底到 zh-CN，
// 故不会被 tsc/运行时发现，只能靠此脚本 + CI 守住）。
//
// 用法：
//   node ../scripts/i18n-check.mjs            # 默认 warning 模式（列缺口，exit 0）
//   node ../scripts/i18n-check.mjs --strict   # 任何缺失即 exit 1（CI 阻塞）
//
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, '..', 'frontend', 'src', 'core', 'i18n', 'locales');
const BASE_LANG = 'zh-CN';
const REFERENCE_LANGS = ['en', 'ja', 'ko', 'zh-TW'];

const strict = process.argv.includes('--strict');

// 抽取 bundle 对象里的所有 key（形如 `  'some.key': '...'` 或 `"some.key": "..."`），
// 排除方法定义（`'x': (...) =>`）——bundle 均为纯字符串值，故可安全过滤。
function extractKeys(file) {
    const text = readFileSync(file, 'utf8');
    const keys = new Set();
    const re = /^\s*['"]([^'"]+)['"]\s*:\s*(?!function\b|\()/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        keys.add(m[1]);
    }
    return keys;
}

function loadBundle(lang) {
    const file = resolve(LOCALES_DIR, `${lang}.ts`);
    return { lang, file, keys: extractKeys(file) };
}

// [doc:adr-059] 占位符一致性校验：提取 bundle 里每个 key 的 {xxx} 占位符集合，
// 比对各语言 bundle 与基准（zh-CN）是否一致。不一致说明某语言漏了占位符或拼错，
// 运行时 t() 会静默不替换，用户看到 {xxx} 裸露。
function extractPlaceholders(file) {
    const text = readFileSync(file, 'utf8');
    const map = new Map(); // key -> Set<string> of placeholder names
    const re = /^\s*['"]([^'"]+)['"]\s*:\s*['"]((?:[^'"\\]|\\.)*)['"]/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        const key = m[1];
        const val = m[2];
        const ph = new Set();
        const phRe = /\{(\w+)\}/g;
        let p;
        while ((p = phRe.exec(val)) !== null) ph.add(p[1]);
        if (ph.size > 0) map.set(key, ph);
    }
    return map;
}

const base = loadBundle(BASE_LANG);
const refs = REFERENCE_LANGS.map(loadBundle);

let totalMissing = 0;
const report = [];

for (const ref of refs) {
    const missing = [...base.keys].filter((k) => !ref.keys.has(k)).sort();
    const extra = [...ref.keys].filter((k) => !base.keys.has(k)).sort();
    totalMissing += missing.length;
    const lines = [
        `[${ref.lang}] base=${base.keys.size} bundle=${ref.keys.size} missing=${missing.length} extra=${extra.length}`,
    ];
    if (missing.length) lines.push('  missing: ' + missing.join(', '));
    if (extra.length) lines.push('  extra (not in base): ' + extra.join(', '));
    report.push(lines.join('\n'));
}

console.log(`i18n parity — base lang: ${BASE_LANG} (${base.keys.size} keys)`);
console.log(report.join('\n'));

// 占位符一致性校验
const basePH = extractPlaceholders(resolve(LOCALES_DIR, `${BASE_LANG}.ts`));
let phIssues = 0;
const phReport = [];
for (const ref of refs) {
    const refPH = extractPlaceholders(resolve(LOCALES_DIR, `${ref.lang}.ts`));
    for (const [key, baseSet] of basePH) {
        const refSet = refPH.get(key);
        if (!refSet) continue; // 该 key 无占位符或缺失（缺失已在上面报）
        const missing = [...baseSet].filter((p) => !refSet.has(p));
        const extra = [...refSet].filter((p) => !baseSet.has(p));
        if (missing.length || extra.length) {
            phIssues++;
            const parts = [];
            if (missing.length) parts.push(`missing {${missing.join('},{')}}`);
            if (extra.length) parts.push(`extra {${extra.join('},{')}}`);
            phReport.push(`  [${ref.lang}] ${key}: ${parts.join('; ')}`);
        }
    }
}
if (phReport.length) {
    console.log(`\n⚠ ${phIssues} placeholder mismatch(es) across bundles:`);
    console.log(phReport.join('\n'));
    console.log('  These cause t() to silently leave {xxx} unreplaced at runtime.');
} else {
    console.log('\n✅ All placeholder sets are consistent across bundles.');
}

if (totalMissing > 0) {
    console.log(`\n⚠ ${totalMissing} key(s) missing across translation bundles.`);
    console.log('  These silently fall back to zh-CN at runtime (t.ts fallback chain).');
    console.log('  Fill them in the corresponding frontend/src/core/i18n/locales/*.ts,');
    console.log('  then this check goes green.');
    if (strict) {
        console.error(`\n[i18n-check] --strict: ${totalMissing} missing key(s) → CI fails.`);
        process.exit(1);
    }
    console.log('  (warning mode — non-blocking. Flip to --strict after gaps cleared.)');
} else {
    console.log('\n✅ All translation bundles are key-aligned with the base.');
}
process.exit(0);
