# E2E 截图基线（Phase 2, ADR-060）

本目录存放 Playwright 视觉回归的**基线指纹**，由 `helpers.ts` 的
`compareToBaseline()` 自动读写。

## 机制

- 每条视觉测试调用 `window.__scene.fingerprint()` 取得当前帧的
  **16×16 亮度指纹**（256 位 `0/1` 字符串）。指纹在浏览器内生成，
  避开对 PNG 做像素解码（且 WebGL canvas 的 `getContext('2d')` 返回 `null`）。
- `compareToBaseline(name, hash, tolerance=0.08)` 用汉明距离比对：
  - 目录内无 `name.json` → **首次运行自动生成基线**并返回 `created:true`
    （CI 首次 seed 时用，不会误报失败）。
  - 已存在 → 计算 `hammingRatio`，`<= tolerance` 视为通过。
- 容忍度默认 `0.08`（256 位中允许约 20 位差异），足以吸收抗锯齿/驱动
  抖动，又能在画面发生实质性变化时失败。

## 重算基线

有意改了渲染效果后，删除对应文件即可在下次运行时重新生成：

```bash
rm e2e/__baselines__/env-sky-solid-white.json
npm run test:e2e
```

## 路径

基线目录锚定 `process.cwd()/e2e/__baselines__`（即 `npm run test:e2e`
的前端包根）。若从其他目录运行 Playwright，请在对应位置放置基线。

## 当前基线

| 名称 | 来源测试 | 说明 |
|------|----------|------|
| `env-sky-solid-white.json` | `env-sky.spec.ts` | 纯色天空 + 三个滑块拉满(1,1,1) 的画面 |
