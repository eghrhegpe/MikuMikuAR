// 临时脚本：提取新 settings 文件用到的 t() key，与 zh-CN 基准包比对，输出缺失清单
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'c:/Users/zhujieling11/MikuMikuAR/frontend/src';
const files = [
    'menus/settings-graphics.ts',
    'menus/settings-controls.ts',
    'menus/settings-media.ts',
    'menus/settings-system.ts',
    'menus/settings-resources.ts',
    'menus/settings-about.ts',
    'menus/settings-actions.ts',
    'menus/settings.ts',
    'menus/settings-appearance.ts',
    'menus/settings-language.ts',
    'menus/settings-shared.ts',
];

// 提取 zh-CN 中已定义的 key
const zhSrc = readFileSync(join(root, 'core/i18n/locales/zh-CN.ts'), 'utf8');
const defined = new Set();
for (const m of zhSrc.matchAll(/^\s*'([^']+)'\s*:/gm)) defined.add(m[1]);

// 提取各文件用到的 t('key')
const used = new Map(); // key -> [files]
for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
        const k = m[1];
        if (!used.has(k)) used.set(k, []);
        used.get(k).push(f);
    }
}

const missing = [...used.keys()].filter((k) => !defined.has(k)).sort();
console.log('=== 缺失 key（共 ' + missing.length + ' 个）===');
for (const k of missing) console.log(k + '  <- ' + [...new Set(used.get(k))].join(', '));
console.log('\n=== 总使用 key 数: ' + used.size + ' / zh-CN 已定义: ' + defined.size + ' ===');
