import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ADR-202 P2 守护测试 — vendored postinstall patch 生效性。
 *
 * `scripts/apply-vendored-wasm.mjs` 靠文本锚点给 1.2.0 的 streamAudioPlayer
 * 注入 `get audio()`（消除 mmd-adapter 对私有 _audio 的反射，compatibility.md 条目 9）。
 * 该 patch 是 P2 唯一「静默失效」高风险环节：锚点一旦因 babylon-mmd 升级漂移，
 * patch 静默跳过 → 运行时 player.audio 为 undefined → 音频 fade/beat/ended 全降级，
 * 而 audio.test.ts 用手造 mock 不经过真实 patch，抓不到此失效。
 *
 * 本测试直接盯 node_modules 里的真实产物 + patch 脚本的锚点常量：
 * - 若 postinstall 没跑 / patch 没生效 → 前两条红
 * - 若 babylon-mmd 升级导致锚点漂移 → 后两条红（早期警报，先于运行时降级）
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const audioDir = join(
  __dirname,
  '..',
  '..',
  'node_modules',
  'babylon-mmd',
  'esm',
  'Runtime',
  'Audio'
);
const jsPath = join(audioDir, 'streamAudioPlayer.js');
const dtsPath = join(audioDir, 'streamAudioPlayer.d.ts');

// patch 脚本依赖的锚点（须与 scripts/apply-vendored-wasm.mjs 保持一致）
const JS_ANCHOR = '\n    _audio;\n';
const DTS_ANCHOR = '\n    private _audio;\n';

describe('ADR-202 P2: vendored patch 生效性守护', () => {
  it('streamAudioPlayer.js 已被 postinstall 注入 get audio()（否则 P2 音频桥失效）', () => {
    expect(existsSync(jsPath)).toBe(true);
    const js = readFileSync(jsPath, 'utf8');
    expect(js).toContain('get audio()');
  });

  it('streamAudioPlayer.d.ts 已被注入 get audio() 声明（否则 player.audio 类型缺失）', () => {
    expect(existsSync(dtsPath)).toBe(true);
    const dts = readFileSync(dtsPath, 'utf8');
    expect(dts).toContain('get audio(): Nullable<HTMLAudioElement>');
  });

  it('patch 锚点在源文件中仍存在 — 升级漂移的早期警报', () => {
    // patch 为「插入」而非「替换」，注入后锚点行仍在；若某次升级删/改了
    // _audio 字段声明，此断言先红，先于运行时音频静默降级暴露问题。
    const js = readFileSync(jsPath, 'utf8');
    const dts = readFileSync(dtsPath, 'utf8');
    expect(js).toContain(JS_ANCHOR);
    expect(dts).toContain(DTS_ANCHOR);
  });
});
