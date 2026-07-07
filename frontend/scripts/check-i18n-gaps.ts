// [doc:adr-059] 检查两语言 bundle 之间的 key 差异
// 用法: npx tsx scripts/check-i18n-gaps.ts
// 零副作用，不改源码，不碰测试

import { zhCN } from '../src/core/i18n/locales/zh-CN';
import { en } from '../src/core/i18n/locales/en';

const zhKeys = new Set(Object.keys(zhCN));
const enKeys = new Set(Object.keys(en));

const missingInEn = [...zhKeys].filter(k => !enKeys.has(k));
const missingInZhCN = [...enKeys].filter(k => !zhKeys.has(k));

let exitCode = 0;

if (missingInEn.length) {
    console.log(`❌ en.ts 缺少 ${missingInEn.length} 个 key（相对 zh-CN）:`);
    for (const k of missingInEn) console.log(`   ${k}`);
    exitCode = 1;
} else {
    console.log('✅ en.ts 与 zh-CN.ts key 完全对齐');
}

if (missingInZhCN.length) {
    console.log(`\n❌ zh-CN.ts 缺少 ${missingInZhCN.length} 个 key（相对 en）:`);
    for (const k of missingInZhCN) console.log(`   ${k}`);
    exitCode = 1;
} else {
    console.log('✅ zh-CN.ts 与 en.ts key 完全对齐');
}

console.log(`\n统计: zh-CN=${zhKeys.size}  en=${enKeys.size}`);
process.exit(exitCode);
