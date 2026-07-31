// @ts-check
// 将 frontend/src/core/i18n/locales/*.ts 编译为独立的 JSON 文件，
// 输出到 frontend/public/locales/，供运行时 fetch 加载。
// 这样语言包不再打包进主 bundle，实现按需加载。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const LOCALE_DIR = path.join(FRONTEND, 'src', 'core', 'i18n', 'locales');
const OUTPUT_DIR = path.join(FRONTEND, 'public', 'locales');

// esbuild 在 frontend/node_modules 里，从 frontend/ 解析
const require = createRequire(FRONTEND + '/package.json');
const esbuild = require('esbuild');

// .ts 文件名 → 导出名映射（zh-CN.ts → zhCN, en.ts → en, …）
const EXPORT_NAMES = {
  'zh-CN.ts': 'zhCN',
  'en.ts': 'en',
  'ja.ts': 'ja',
  'ko.ts': 'ko',
  'zh-TW.ts': 'zhTW',
};

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [fileName, exportName] of Object.entries(EXPORT_NAMES)) {
    const entryPath = path.join(LOCALE_DIR, fileName);
    if (!fs.existsSync(entryPath)) {
      console.warn(`[generate-locale-json] 跳过不存在的文件: ${entryPath}`);
      continue;
    }

    // 用 esbuild 编译 .ts → CJS
    const result = await esbuild.build({
      entryPoints: [entryPath],
      format: 'cjs',
      write: false,
      bundle: false,
      sourcemap: false,
      minify: false,
    });

    const code = result.outputFiles[0].text;

    // 在沙箱中执行 CJS 模块
    const mod = { exports: {} };
    const fn = new Function('module', 'exports', code);
    fn(mod, mod.exports);
    const data = mod.exports[exportName];

    if (!data || typeof data !== 'object') {
      console.error(`[generate-locale-json] 无法从 ${fileName} 提取导出 ${exportName}`);
      continue;
    }

    const langKey = fileName.replace('.ts', '');
    const outPath = path.join(OUTPUT_DIR, `${langKey}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data), 'utf-8');
    const sizeKb = (Buffer.byteLength(fs.readFileSync(outPath), 'utf-8') / 1024).toFixed(0);
    console.log(`[generate-locale-json] ✓ ${langKey}.json (${sizeKb} KB)`);
  }

  console.log('[generate-locale-json] 完成');
}

main().catch((err) => {
  console.error('[generate-locale-json] 失败:', err);
  process.exit(1);
});