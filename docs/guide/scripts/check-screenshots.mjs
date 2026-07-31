#!/usr/bin/env node
// 用户指南截图健康检查
// 规则（一文一图）：每个 guide 功能页应恰好引用一张同名截图 img/<page>-1.png，
// 且该文件必须真实存在、非 0 字节占位。
// 用法：node docs/guide/scripts/check-screenshots.mjs [--json]
// 退出码：有缺失/占位/命名不符 → 1；全部就绪 → 0。CI 可卡点。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUIDE_DIR = resolve(__dirname, '..');
const IMG_DIR = join(GUIDE_DIR, 'img');

// 非功能页：不参与一文一图检查
const SKIP = new Set(['README.md', 'index.md']);
const IMG_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

const jsonMode = process.argv.includes('--json');

// 小于此字节数的 png 视为占位/损坏图（真实 UI 面板截图远大于此）
const PLACEHOLDER_MAX_BYTES = 2048;

const pages = readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith('.md') && !SKIP.has(f))
    .sort();

const rows = [];
for (const page of pages) {
    const slug = page.replace(/\.md$/, '');
    const body = readFileSync(join(GUIDE_DIR, page), 'utf8');

    // 提取正文所有图片引用（只取指向 img/ 的）
    const refs = [...body.matchAll(IMG_RE)]
        .map((m) => m[1].trim())
        .filter((p) => p.includes('img/'));

    const expected = `img/${slug}-1.png`;
    let status, hint;

    if (refs.length === 0) {
        status = 'MISSING_REF';
        hint = `正文未引用截图，请加：![${slug}](${expected})，并放置该图`;
    } else if (refs.length > 1) {
        status = 'MULTI_REF';
        hint = `引用了 ${refs.length} 张图（一文一图规范只留一张）：${refs.join(', ')}`;
    } else {
        const ref = refs[0];
        const fileName = ref.split('/').pop();
        const abs = join(IMG_DIR, fileName);
        if (!existsSync(abs)) {
            status = 'NO_FILE';
            hint = `引用 ${ref} 但文件不存在——请截图并保存为 img/${fileName}`;
        } else if (statSync(abs).size <= PLACEHOLDER_MAX_BYTES) {
            status = 'PLACEHOLDER';
            hint = `img/${fileName} 仅 ${statSync(abs).size} 字节（占位/损坏图）——请用真实截图替换`;
        } else if (fileName !== `${slug}-1.png`) {
            status = 'NAME_MISMATCH';
            hint = `图名 ${fileName} 与规范不符，建议改为 ${slug}-1.png`;
        } else {
            status = 'OK';
            hint = '';
        }
    }
    rows.push({ page, slug, expected, status, hint });
}

const bad = rows.filter((r) => r.status !== 'OK');

if (jsonMode) {
    console.log(JSON.stringify({ total: rows.length, ok: rows.length - bad.length, rows }, null, 2));
    process.exit(bad.length ? 1 : 0);
}

const ICON = {
    OK: '🟢',
    MISSING_REF: '🔴',
    NO_FILE: '🔴',
    PLACEHOLDER: '🟡',
    MULTI_REF: '🟠',
    NAME_MISMATCH: '🟠',
};

console.log(`\n📸 用户指南截图健康检查（一文一图）\n${'='.repeat(48)}`);
for (const r of rows) {
    const line = `${ICON[r.status] ?? '⚪'} ${r.slug.padEnd(18)} ${r.status}`;
    console.log(r.hint ? `${line}\n     └─ ${r.hint}` : line);
}
console.log(`${'='.repeat(48)}`);
console.log(`共 ${rows.length} 页，就绪 ${rows.length - bad.length}，待处理 ${bad.length}\n`);

if (bad.length) {
    const todo = bad.filter((r) => ['MISSING_REF', 'NO_FILE', 'PLACEHOLDER'].includes(r.status));
    if (todo.length) {
        console.log('📋 待截图清单（截图后按对应文件名放入 docs/guide/img/）：');
        for (const r of todo) {
            console.log(`   • ${r.slug}-1.png  ← ${r.page}`);
        }
        console.log('');
    }
}

process.exit(bad.length ? 1 : 0);
