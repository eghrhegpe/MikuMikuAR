// [doc:adr-099] 真机 SAB / MPR 验证脚本
// 用法：VITE_MMD_WASM_MT=1 构建 + 同 flag 启动 .exe（设 MMCAR_DEBUG_PORT=9222），
// 在 Edge 访问 http://localhost:9222 打开 WebView2 DevTools，粘贴本脚本到 Console 执行。
// 全绿 = 跨源隔离生效、SharedArrayBuffer 可用、MPR 多线程物理已就绪。
(() => {
  const ok = (b) => b ? '✅ PASS' : '❌ FAIL';
  const coi = self.crossOriginIsolated === true;
  const sab = typeof SharedArrayBuffer === 'function';
  const cores = navigator.hardwareConcurrency || 0;

  console.group('%c[ADR-099] SAB / MPR 真机自检', 'font-weight:bold;font-size:14px');
  console.log(`${ok(coi)}  crossOriginIsolated = ${self.crossOriginIsolated}`);
  console.log(`${ok(sab)}  typeof SharedArrayBuffer = ${typeof SharedArrayBuffer}`);
  console.log(`ℹ️  navigator.hardwareConcurrency = ${cores}（MPR 可用线程数上界）`);

  // 实测能否真正分配 SAB（COI=true 但 SAB 被禁的极端情况会在此暴露）
  let alloc = false;
  if (sab) {
    try { new SharedArrayBuffer(1024); alloc = true; } catch (e) { console.warn('SAB alloc 抛错：', e); }
  }
  console.log(`${ok(alloc)}  new SharedArrayBuffer(1024) 分配`);

  const pass = coi && sab && alloc;
  console.log(`%c总判定：${pass ? '✅ MPR 前置条件全部满足' : '❌ 未满足，见上方 FAIL 项 + 下方排障'}`,
    `font-weight:bold;color:${pass ? '#3fb950' : '#f85149'}`);
  console.groupEnd();

  if (!pass) {
    console.group('%c排障提示', 'font-weight:bold');
    if (!coi) console.log('• COI=false：主文档响应头缺 COOP/COEP → 确认「启动进程」时也设了 VITE_MMD_WASM_MT（构建期设 ≠ 运行期设，两处都要）；Network 面板查主文档 Response Headers 是否含 same-origin / require-corp。');
    if (coi && !sab) console.log('• COI=true 但无 SAB：WebView2 运行时版本过旧，升级 Microsoft Edge WebView2 Runtime。');
    console.log('• 另核对 Console 是否有 “[scene] 使用 WASM 版 MmdWasmRuntime（MPR 多线程物理）”——出现则前端已走 MPR 分支（构建期 flag 生效）。');
    console.groupEnd();
  }
  return { crossOriginIsolated: coi, sharedArrayBuffer: sab, allocOK: alloc, cores, pass };
})();
