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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, '..', 'frontend', 'src', 'core', 'i18n', 'locales');
const BASE_LANG = 'zh-CN';
const REFERENCE_LANGS = ['en', 'ja', 'ko', 'zh-TW'];

const { strict, json } = parseArgs(process.argv.slice(2), { bools: ['strict', 'json'], strings: [], defaults: {} });
const log = json ? () => {} : console.log.bind(console);

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
    const re = /^\s*['"]([^'"]+)['"]\s*:\s*['"]((?:\\.|[^'\\])*)['"]/gm;
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

log(`i18n parity — base lang: ${BASE_LANG} (${base.keys.size} keys)`);
log(report.join('\n'));

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
    log(`\n⚠ ${phIssues} placeholder mismatch(es) across bundles:`);
    log(phReport.join('\n'));
    log('  These cause t() to silently leave {xxx} unreplaced at runtime.');
} else {
    log('\n✅ All placeholder sets are consistent across bundles.');
}

if (totalMissing > 0) {
    log(`\n⚠ ${totalMissing} key(s) missing across translation bundles.`);
    log('  These silently fall back to zh-CN at runtime (t.ts fallback chain).');
    log('  Fill them in the corresponding frontend/src/core/i18n/locales/*.ts,');
    log('  then this check goes green.');
    if (strict && !json) {
        console.error(`\n[i18n-check] --strict: ${totalMissing} missing key(s) → CI fails.`);
        process.exit(1);
    }
    log('  (warning mode — non-blocking. Flip to --strict after gaps cleared.)');
} else {
    log('\n✅ All translation bundles are key-aligned with the base.');
}

// ======== ADR-212 P4: 漏译检测（zh-CN 中纯英文值）========
// 检测基准语言包中值不含任何中文字符的条目，这些条目可能是漏译。
// 不包含中文字符的值通常意味着翻译未完成（直接复制了英文 key 的值）。
function extractKeyValues(file) {
    const text = readFileSync(file, 'utf8');
    const map = new Map();
    const re = /^\s*['"]([^'"]+)['"]\s*:\s*['"]((?:\\.|[^'\\])*)['"]/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
        map.set(m[1], m[2]);
    }
    return map;
}

const zhCNEntries = extractKeyValues(resolve(LOCALES_DIR, `${BASE_LANG}.ts`));
// 设计如此豁免：值为品牌名 / 技术术语 / 符号占位符模板，无需中文翻译。
// 新增此类 key 时须同时登记于此，否则 strict 模式会误报。
const KNOWN_INTENTIONAL = new Set([
    'lang.en', // 语言自名
    'lang.ko', // 语言自名（韩文）
    'model-detail.morphTypeUV', // 技术缩写
    'motion.retarget.mixamo', // 品牌名
    'motion.retarget.vrm', // 技术名
    'motion.poseStudio.tPose', // 姿势名
    'motion.poseStudio.aPose', // 姿势名
    'motion.ikTag', // 缩写
    'scene.loader.actorLoaded', // 符号 + 占位符模板
    'scene.loader.actorLoadedWithVmd', // 符号 + 占位符模板
    'scene.vmd.loaded', // 符号 + 占位符模板
    'settings.error', // 符号 + 占位符模板
    'settings.toggleState', // 符号 + 占位符模板
    'ai.config.httpError', // HTTP 错误码模板
    'ai.provider.ollama', // 品牌名
    'ai.provider.deepseek', // 品牌名
    'ai.provider.openai', // 品牌名
    'ai.provider.openrouter', // 品牌名
]);
const untranslated = [];
for (const [key, value] of zhCNEntries) {
    if (KNOWN_INTENTIONAL.has(key)) continue;
    // 检测是否包含中文字符（CJK 统一表意文字范围）
    if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(value) && value.length > 0) {
        untranslated.push({ key, value });
    }
}

if (untranslated.length > 0) {
    const maxShow = 20;
    const shown = untranslated.slice(0, maxShow);
    log(`\n⚠ ${untranslated.length} 个 zh-CN 条目疑似漏译（值不含中文字符）:`);
    for (const { key, value } of shown) {
        log(`  ${key}: '${value}'`);
    }
    if (untranslated.length > maxShow) {
        log(`  ... 及其他 ${untranslated.length - maxShow} 个条目`);
    }
    log('  这些条目在 zh-CN.ts 中为纯英文，可能是翻译遗漏。');
    if (strict && !json) {
        console.error(`\n[i18n-check] --strict: ${untranslated.length} untranslated entry(s) → CI fails.`);
        process.exit(1);
    }
    log('  (warning mode — non-blocking.)');
} else {
    log('\n✅ zh-CN 基准包无漏译（所有条目均含中文字符）。');
}

// ======== AVAILABLE_LANGS 与 locales/*.ts 文件集一致性校验 ========
// t.ts 的 AVAILABLE_LANGS 是「有 bundle 的语言」权威清单，语言菜单据此过滤。
// 若与 locales/*.ts 实际文件集漂移：多列 → 菜单出现但 bundle 缺失（fetch 404 → 静默回退中文）；
// 少列 → 已补全 bundle 的语言不显示。两者都是静默漂移，故在此守一道 CI 护栏。
const T_TS_PATH = resolve(__dirname, '..', 'frontend', 'src', 'core', 'i18n', 't.ts');
const T_TS = readFileSync(T_TS_PATH, 'utf8');
const availMatch = T_TS.match(/AVAILABLE_LANGS\s*:\s*string\[\]\s*=\s*\[([^\]]*)\]/);
const availableLangs = availMatch
    ? availMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/['"]/g, ''))
          .filter(Boolean)
    : [];
const langFiles = readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''));
const availSet = new Set(availableLangs);
const fileSet = new Set(langFiles);
const inAvailNotFile = availableLangs.filter((l) => !fileSet.has(l));
const inFileNotAvail = langFiles.filter((f) => !availSet.has(f));

if (inAvailNotFile.length || inFileNotAvail.length) {
    log('\n⚠ AVAILABLE_LANGS (t.ts) 与 locales/*.ts 文件集不一致:');
    if (inAvailNotFile.length) log('  仅声明于 AVAILABLE_LANGS 但无 bundle 文件: ' + inAvailNotFile.join(', '));
    if (inFileNotAvail.length) log('  存在 bundle 文件但未列入 AVAILABLE_LANGS: ' + inFileNotAvail.join(', '));
    log('  请同步 frontend/src/core/i18n/t.ts 与 frontend/src/core/i18n/locales/。');
    if (strict && !json) {
        console.error('\n[i18n-check] --strict: AVAILABLE_LANGS 与文件集不一致 → CI fails.');
        process.exit(1);
    }
    log('  (warning mode — non-blocking.)');
} else {
    log(`\n✅ AVAILABLE_LANGS (${availableLangs.length}) 与 locales/*.ts 文件集完全一致。`);
}
if (json) {
    const failed =
        totalMissing > 0 ||
        phIssues > 0 ||
        untranslated.length > 0 ||
        inAvailNotFile.length > 0 ||
        inFileNotAvail.length > 0;
    console.log(
        JSON.stringify(
            {
                baseLang: BASE_LANG,
                baseKeys: base.keys.size,
                keyParity: report,
                placeholderMismatches: phReport,
                untranslated,
                langListDrift: { inAvailNotFile, inFileNotAvail },
            },
            null,
            2
        )
    );
    process.exit(failed && strict ? 1 : 0);
}
process.exit(0);
