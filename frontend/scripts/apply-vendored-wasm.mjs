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
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');
const vendorRoot = join(frontendRoot, 'vendor', 'babylon-mmd-wasm');
const targetRoot = join(
  frontendRoot,
  'node_modules',
  'babylon-mmd',
  'esm',
  'Runtime',
  'Optimized',
  'wasm'
);

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
