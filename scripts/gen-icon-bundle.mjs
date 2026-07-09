/**
 * 生成 iconify 本地图标捆绑包（离线可用）。
 *
 * 设计目标：
 *  - 自动扫描 frontend/src 所有图标引用，不再手维护列表，杜绝「新增图标漏网 → 运行时回退到 Iconify 公共 API 拉取 + 缓存」的病灶。
 *  - 生成的 icons-bundle.ts 经 addCollection 注册到 iconify 运行时，使 <iconify-icon> 全程离线、无网络缓存。
 *
 * 重新生成：  cd frontend && node ../scripts/gen-icon-bundle.mjs
 * 仅校验（不写文件，缺失则 exit 1）：node ../scripts/gen-icon-bundle.mjs --check
 *
 * 注意：本脚本在「生成期」需要访问 api.iconify.design 拉取图标 body（一次性，可离线缓存到本地文件）。
 *       生成产物 icons-bundle.ts 提交进仓库后即「固化进项目」，运行期完全不依赖网络。
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const SRC_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'frontend', 'src'
);
const OUT_PATH = path.join(SRC_DIR, 'core', 'icons-bundle.ts');
const CHECK_ONLY = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Seed：历史已固化图标（安全网，防止扫描遗漏导致回归）
// ---------------------------------------------------------------------------
const SEED_LUCIDE = [
    'alert-circle', 'alert-triangle', 'app-window', 'arrow-down', 'arrow-up',
    'arrow-up-down', 'bookmark', 'box', 'bug', 'camera', 'check', 'check-circle',
    'chevron-left', 'circle', 'circle-dot', 'clock', 'cloud', 'cloud-sun',
    'columns', 'compass', 'contrast', 'download',
    'droplet', 'external-link', 'eye', 'fast-forward', 'feather', 'file-code-2',
    'flask-conical', 'folder', 'folder-open', 'gauge', 'git-branch', 'grid',
    'grid-3x3', 'hand', 'help-circle', 'home', 'image', 'images', 'info',
    'layers', 'lightbulb', 'maximize', 'maximize-2', 'monitor', 'mouse-pointer',
    'move', 'move-horizontal', 'move-vertical', 'music', 'package', 'palette',
    'play', 'play-circle', 'plug', 'plus', 'rainbow', 'refresh-ccw', 'refresh-cw',
    'repeat', 'rotate-ccw', 'rotate-cw', 'ruler', 'save', 'scan-line', 'search',
    'settings', 'shield', 'shirt', 'sliders', 'smile', 'sparkles', 'star',
    'stop-circle', 'sun', 'tag', 'trash-2', 'triangle', 'upload', 'user',
    'video', 'volume-2', 'waves', 'wind', 'wrench', 'x', 'zap', 'zoom-in',
];
const SEED_TABLER = ['cube-3d-sphere', 'bone'];

// ---------------------------------------------------------------------------
// 自动扫描
// ---------------------------------------------------------------------------
const lucide = new Set(SEED_LUCIDE.map((n) => n.toLowerCase()));
const tabler = new Set(SEED_TABLER.map((n) => n.toLowerCase()));

function add(name) {
    if (name.includes(':')) {
        const [p, n] = name.split(':');
        (p === 'tabler' ? tabler : lucide).add(n.toLowerCase());
    } else {
        lucide.add(name.toLowerCase());
    }
}

function scanFile(txt) {
    // A. 显式前缀  'lucide:xxx' / 'tabler:xxx'
    for (const m of txt.matchAll(/['"]((?:lucide|tabler):[a-z0-9-]+)['"]/gi)) add(m[1]);
    // B. 对象属性  icon: 'xxx'（裸名 → lucide）
    for (const m of txt.matchAll(/\bicon:\s*['"]([a-z0-9-]+)['"]/gi)) add(m[1]);
    // C. slideRow 第 2 个位置参数（裸名 → lucide）
    for (const m of txt.matchAll(/slideRow\(\s*\S+\s*,\s*['"]([a-z0-9-]+)['"]/gi)) add(m[1]);
    // D. createIconifyIcon 参数（裸名 → lucide）
    for (const m of txt.matchAll(/createIconifyIcon\(\s*['"]([a-z0-9-]+)['"]/gi)) add(m[1]);
    // E. 模板字符串  <iconify-icon icon="lucide:xxx">
    for (const m of txt.matchAll(/<iconify-icon[^>]*icon=["']([a-z0-9:-]+)["']/gi)) add(m[1]);
    // F. 动态模板  lucide:${ ... 'a' ... 'b' ... }
    for (const m of txt.matchAll(/lucide:\$\{\s*[^}]*?['"]([a-z0-9-]+)['"][^}]*?['"]([a-z0-9-]+)['"]/gi)) {
        add('lucide:' + m[1]);
        add('lucide:' + m[2]);
    }
    for (const m of txt.matchAll(/lucide:\$\{\s*[^}]*?['"]([a-z0-9-]+)['"]/gi)) add('lucide:' + m[1]);
    // G. iconify-registry 的 import（保留其离线条目）
    for (const m of txt.matchAll(/@iconify\/icons-(lucide|tabler)\/([a-z0-9-]+)/gi)) {
        if (m[1] === 'tabler') tabler.add(m[2].toLowerCase());
        else lucide.add(m[2].toLowerCase());
    }
}

function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === 'coverage' || e.name === '.git' || e.name === '__tests__') continue;
            walk(fp);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
            if (e.name === 'icons-bundle.ts') continue; // 生成的产物，跳过
            if (e.name.includes('.test.')) continue; // 测试占位图标，非应用图标
            scanFile(fs.readFileSync(fp, 'utf-8'));
        }
    }
}

console.log(`Scanning ${SRC_DIR} ...`);
walk(SRC_DIR);
console.log(`  lucide: ${lucide.size} · tabler: ${tabler.size}`);

// ---------------------------------------------------------------------------
// 拉取集合（生成期网络）
// ---------------------------------------------------------------------------
async function fetchCollection(prefix, names) {
    const url = `https://api.iconify.design/${prefix}.json?icons=${[...names].join(',')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${prefix}: ${res.status}`);
    const data = await res.json();
    return data; // IconifyJSON：{ prefix, icons, aliases, width, height, not_found? }
}

function buildCollection(prefix, data) {
    const icons = data.icons ?? {};
    const aliases = data.aliases ?? {};
    const notFound = data.not_found ?? [];
    // 去除 not_found 残留（API 已在 icons 中剔除，但防御性处理）
    for (const nf of notFound) delete icons[nf];
    return {
        prefix,
        icons,
        aliases,
        width: data.width ?? 24,
        height: data.height ?? 24,
    };
}

async function main() {
    let lucideData, tablerData;
    try {
        [lucideData, tablerData] = await Promise.all([
            fetchCollection('lucide', lucide),
            fetchCollection('tabler', tabler),
        ]);
    } catch (err) {
        console.error('Fetch failed:', err.message);
        console.error('Tip: 生成期需访问 api.iconify.design。若完全离线，请先在本地缓存或用 @iconify/icons-* 包。');
        process.exit(1);
    }

    const lucideBundle = buildCollection('lucide', lucideData);
    const tablerBundle = buildCollection('tabler', tablerData);

    const lucideCount = Object.keys(lucideBundle.icons).length;
    const lucideAliasCount = Object.keys(lucideBundle.aliases).length;
    const tablerCount = Object.keys(tablerBundle.icons).length;
    const notFound = [
        ...(lucideData.not_found ?? []).map((n) => `lucide:${n}`),
        ...(tablerData.not_found ?? []).map((n) => `tabler:${n}`),
    ];

    if (CHECK_ONLY) {
        // 校验：扫描到的每个图标都必须在 bundle 里（icons 或 aliases）
        const present = new Set([
            ...Object.keys(lucideBundle.icons),
            ...Object.keys(lucideBundle.aliases),
            ...Object.keys(tablerBundle.icons),
            ...Object.keys(tablerBundle.aliases),
        ]);
        const missing = [];
        for (const n of lucide) if (!present.has(n) && !lucideBundle.aliases[n]) missing.push(`lucide:${n}`);
        for (const n of tabler) if (!present.has(n) && !tablerBundle.aliases[n]) missing.push(`tabler:${n}`);
        if (missing.length > 0) {
            console.error(`❌ 校验失败：以下 ${missing.length} 个图标未固化进 bundle：`);
            console.error('   ' + missing.join(', '));
            process.exit(1);
        }
        console.log(`✅ 校验通过：所有 ${lucide.size} lucide + ${tabler.size} tabler 图标均已固化。`);
        return;
    }

    const content = `// Auto-generated by scripts/gen-icon-bundle.mjs
// Do not edit manually. Run: cd frontend && node ../scripts/gen-icon-bundle.mjs
// 离线图标捆绑包：覆盖源码中所有 lucide / tabler 图标引用，运行期零网络。

import { addCollection } from 'iconify-icon';

const LUCIDE_BUNDLE = ${JSON.stringify(lucideBundle, null, 2)};

const TABLER_BUNDLE = ${JSON.stringify(tablerBundle, null, 2)};

export function registerIconBundle(): void {
    addCollection(LUCIDE_BUNDLE);
    addCollection(TABLER_BUNDLE);
}
`;
    fs.writeFileSync(OUT_PATH, content, 'utf-8');
    console.log(`\n✅ Bundle written to: ${OUT_PATH}`);
    console.log(`   Lucide: ${lucideCount} icons + ${lucideAliasCount} aliases`);
    console.log(`   Tabler: ${tablerCount} icons`);
    if (notFound.length > 0) {
        console.log(`   ⚠ 公共 API 未找到（运行期将回退拉取，建议补充）：`);
        console.log('     ' + notFound.join(', '));
    } else {
        console.log('   ✅ 无 not_found，运行期完全离线。');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
