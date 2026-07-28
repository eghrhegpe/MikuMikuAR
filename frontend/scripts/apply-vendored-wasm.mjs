// apply-vendored-wasm.mjs
// ADR-202 P0: 把 vendor/babylon-mmd-wasm/ 的 P2 wasm 产物注入 node_modules/babylon-mmd。
// 官方发布的 babylon-mmd 1.2.0 不含 P2 导出（getMmdModelRigidBodyBundleLen /
// mmdModelRigidBodyApplyCentralForce），npm ci 后需把 fork 重编译的 spr/mpr 变体覆盖进去，
// 否则生产加载的 spr（单线程）/ mpr（多线程）路径下模型原生刚体风力无效（ADR-200/201）。
//
// 生产只加载 spr（singlePhysicsRelease）与 mpr（multiPhysicsRelease）两个变体
// （见 node_modules/babylon-mmd/esm/Runtime/Optimized/InstanceType/*.js 的 `../wasm/{spr,mpr}` import）；
// mpd 是 debug 变体，仅本地/单测用，不分发。
//
// npm ci 会先清空 node_modules 再装依赖，postinstall 在装完后执行 —— 注入不会被清掉。
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const vendorRoot = join(frontendRoot, 'vendor', 'babylon-mmd-wasm');
const mmdRoot = join(frontendRoot, 'node_modules', 'babylon-mmd', 'esm');
const targetRoot = join(mmdRoot, 'Runtime', 'Optimized', 'wasm');

const variants = ['spr', 'mpr'];
let injected = 0;

for (const v of variants) {
  const src = join(vendorRoot, v);
  const dst = join(targetRoot, v);
  if (!existsSync(src)) {
    console.warn(`[vendored-wasm] skip ${v}: vendor source missing at ${src}`);
    continue;
  }
  if (!existsSync(dst)) {
    mkdirSync(dst, { recursive: true });
  }
  cpSync(src, dst, { recursive: true, force: true });
  console.log(`[vendored-wasm] injected ${v} -> ${dst}`);
  injected++;
}

if (injected === 0) {
  console.warn(
    '[vendored-wasm] no variants injected. P2 wind force on native rigid bodies will not work.'
  );
} else {
  console.log(`[vendored-wasm] done (${injected}/${variants.length} variants)`);
}

// --- ADR-202 P2（条目 9）: patch StreamAudioPlayer 暴露 get audio() ---
// 对 1.2.0 的 streamAudioPlayer.js/.d.ts 做精准文本替换，加只读 getter，
// 以消除 mmd-adapter 对私有 _audio 字段的反射（compatibility.md 条目 9）。
// 1.2.0 被 lockfile 锁死 integrity，文件内容固定，锚点稳定；若未来升级到其他
// 版本，锚点不匹配则自动跳过（console.warn），不会损坏文件。
function patchStreamAudioPlayer() {
  const audioDir = join(mmdRoot, 'Runtime', 'Audio');
  const jsPath = join(audioDir, 'streamAudioPlayer.js');
  const dtsPath = join(audioDir, 'streamAudioPlayer.d.ts');

  // .js: 在 `_audio;` 声明行后插入 getter
  if (existsSync(jsPath)) {
    let js = readFileSync(jsPath, 'utf8');
    const marker = '    _audio;\n';
    if (js.includes('get audio()')) {
      console.log('[vendored-wasm] streamAudioPlayer.js already has get audio(), skip');
    } else if (js.includes(marker)) {
      js = js.replace(marker, marker + '    get audio() {\n        return this._audio;\n    }\n');
      writeFileSync(jsPath, js);
      console.log('[vendored-wasm] patched streamAudioPlayer.js: added get audio()');
    } else {
      console.warn('[vendored-wasm] streamAudioPlayer.js marker not found, skip (version drift?)');
    }
  }

  // .d.ts: 在 `private _audio;` 声明行后插入 getter 声明（Nullable 已在顶部 import）
  if (existsSync(dtsPath)) {
    let dts = readFileSync(dtsPath, 'utf8');
    const marker = '    private _audio;\n';
    if (dts.includes('get audio()')) {
      console.log('[vendored-wasm] streamAudioPlayer.d.ts already has get audio(), skip');
    } else if (dts.includes(marker)) {
      dts = dts.replace(
        marker,
        marker + '    /** Underlying HTMLAudioElement (readonly, null if not loaded) */\n    get audio(): Nullable<HTMLAudioElement>;\n'
      );
      writeFileSync(dtsPath, dts);
      console.log('[vendored-wasm] patched streamAudioPlayer.d.ts: added get audio()');
    } else {
      console.warn('[vendored-wasm] streamAudioPlayer.d.ts marker not found, skip (version drift?)');
    }
  }
}

patchStreamAudioPlayer();
