# [vendored-patch 守护测试 + apply-vendored-wasm.mjs] — 审核结果

**审核范围：**
- 测试文件：`frontend/src/__tests__/vendored-patch.test.ts`（60 行）
- 守护目标：`frontend/scripts/apply-vendored-wasm.mjs`（92 行，ADR-202 P2 vendored postinstall patch）
- node_modules 真实产物：`node_modules/babylon-mmd/esm/Runtime/Audio/streamAudioPlayer.{js,d.ts}`
- 关联消费方：`frontend/src/core/mmd-adapter.ts`（getStreamAudio，条目 9）

**总体结论：⚠️ 有条件通过**

测试 3/3 全绿（实测 `npm run test -- src/__tests__/vendored-patch.test.ts`，26ms），守护的核心目的——「盯 node_modules 真实产物，patch 未生效 / 锚点漂移早期警报」——成立且有效。但存在一个**机制性事实偏差**：该 patch 的载体（postinstall 注入）已于 2026-07-31 被 ADR-202 的 `-dist` 分支方案取代（frontend/package.json 已无 postinstall），patch 脚本已沦为**孤儿代码**，测试注释与 mmd-adapter 运行期告警仍指向已死的机制。测试本身应保留（现在守护的是 `-dist` 分支产物的真实交付物，价值更高），但须同步清理脚本/目录并刷新注释契约。

---

## 亮点

- **守护层选得准——直盯交付物而非 mock**：测试用 `node:fs` 读 node_modules 真实产物断言 `get audio()`（`vendored-patch.test.ts:41-43`、46-50），这是「patch 没跑 / 产物缺 getter」唯一可观测的层。测试头注释明确点出 audio.test.ts 用手造 mock 抓不到此失效（`vendored-patch.test.ts:14`）——判断正确，`mmd-adapter.native.test.ts` 确为 `vi.fn` 全 mock。
- **锚点漂移早期警报设计（优于运行期降级）**：第 3 个 it 块断言注入后锚点行仍在（`vendored-patch.test.ts:52-59`），利用「插入式 patch 锚点行不消失」的特性，锚点一旦被上游删/改即先红，先于 mmd-adapter 的守卫式降级暴露问题。
- **测试锚点比脚本 marker 更严格**：测试锚点带前导 `\n`（`'\n    _audio;\n'`，vendored-patch.test.ts:36-37），隐式行首锚定，比脚本的裸 marker（`'    _audio;\n'`）更能抵御「字段声明改行」类漂移。
- **脚本幂等性守卫**：`js.includes('get audio()')` 命中即 skip（`apply-vendored-wasm.mjs:62-63, 77-78`），重复执行/升级后重装不会二次注入。
- **安装期 fail-soft + CI 期 fail-hard 双层告警**：脚本锚点找不到时 console.warn 且退出码 0（`apply-vendored-wasm.mjs:68-70, 86-88`），不破坏 `npm ci`；真正的硬警报由测试承担。分层合理。
- **wasm 侧有独立护栏**：spr/mpr 的 P2 导出由 `physics-contract.*.test.ts` / `wind-physics-integration.test.ts` 直接 import 真实 `wasm/spr` 模块契约测试守护，与音频 getter 的 fs 守护互补，P0/P2 双面覆盖完整。
- **环境声明正确**：`// @vitest-environment node`（`vendored-patch.test.ts:1`），fs 访问无需 DOM，与 135 个无 DOM 测试的 node 分流策略一致。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | frontend/scripts/apply-vendored-wasm.mjs + frontend/vendor/babylon-mmd-wasm/ | 全文件 | **脚本已被 -dist 分支取代成孤儿代码**：ADR-202 首部（2026-07-31）声明 postinstall 移除、patch 由 fork `-dist` 分支自带；实测 frontend/package.json 无 postinstall、.github CI 零引用。脚本 + vendor wasm（~200KB 二进制）仍留仓，且测试的「锚点须与脚本保持一致」契约挂在死代码上；若有人手动重跑脚本，`cpSync(force)`（apply-vendored-wasm.mjs:35）会用仓内旧 vendor wasm 覆盖 `-dist` 新产物，制造静默回退。 | 删除脚本 + vendor 目录（在 ADR-202 记录废弃），测试保留并改注为「守护 fork -dist 分支交付物」；若需保留回滚通道，改为文档说明而非活代码。 |
| 🟡 P3 | vendored-patch.test.ts:35-37 vs apply-vendored-wasm.mjs:61,76 | 锚点常量 | **锚点常量双份且已漂移**：注释声称「须与 scripts/apply-vendored-wasm.mjs 保持一致」，但测试锚点带前导 `\n`、脚本 marker 不带——二者本就不等（测试更严格）。跨 .mjs/.ts 无共享导入机制，「保持一致」无强制力，漂移已发生即为证据。 | 二选一：a) 锚点抽成共享常量文件（如 `frontend/scripts/vendored-anchors.mjs` 被脚本 import、测试读同源）；b) 至少把注释改为明示「测试锚点故意比脚本更严格（行首锚定）」。 |
| 🟡 P3 | vendored-patch.test.ts:40-59 | 断言仅 contains | **无位置/类作用域断言**：只验 `contains('get audio()')`，不验 getter 位于 `class StreamAudioPlayer` 内且紧跟 `_audio;` 之后。若上游新增第二个 `_audio;` 字段（多类文件），注入落到错误位置时测试仍绿、运行期仍降级（仅 mmd-adapter 告警）。 | 加顺序断言：`indexOf('class StreamAudioPlayer') < indexOf('get audio()')`，或正则匹配注入块原文 `get audio\(\) \{\s*return this\._audio;\s*\}`，一次钉住内容+位置。 |
| 🟡 P3 | frontend/src/core/mmd-adapter.ts:120 | 运行期告警文案 | 最后防线告警仍写「postinstall patch 未生效…检查 apply-vendored-wasm.mjs」，指向已死机制；诊断时会把排查者引向 404。docs 侧同类漂移：compatibility.md 条目 9（babylon-mmd-compatibility.md:225-236）仍示 `_audio` 反射代码、knowledge/mmd-adapter.md:59 仍称「依赖私有 _audio 反射」（round-12 已标记过，未修）。 | 文案改为「fork -dist 分支产物缺失 get audio()（上游移除或重建未含补丁），检查 vendored-patch.test.ts 与 babylon-mmd 版本」；同步刷新两条 docs。 |
| 🟡 P3 | apply-vendored-wasm.mjs:65,80 | replace 次数未校验 | `js.replace(marker, …)` 字符串替换只处理首个命中，无出现次数校验；若 marker 出现 2 次（多字段声明），getter 插到错误位置且无警告。 | 替换前校验 `split(marker).length - 1 === 1`，不等于 1 时 console.warn 并跳过。 |
| 🟢 P4 | vendored-patch.test.ts:17-18,10 | 注释漂移 | 注释「前两条红 / 后两条红」与实际 3 个 it 块不符；脚本路径写 `scripts/apply-vendored-wasm.mjs`（实际 `frontend/scripts/…`，根级无此文件）。 | 随 P2 修复一并改写注释，路径写全。 |
| 🟢 P4 | vendored-patch.test.ts:42,55 | 重复读文件 | js/dts 在 it1/it3 各读一遍，全量 26ms 内可忽略。 | 可 `beforeAll` 缓存为常量，非必须。 |

---

## 测试质量评价

| 维度 | 评价 |
|------|------|
| 断言有效性 | ✅ 读**真实 node_modules 产物**（fs 直读 + existsSync），非 mock；「patch 未生效」→ it1/it2 红，「锚点漂移」→ it3 红，两条失效路径都能抓住 |
| 早期警报能力 | ✅ 锚点断言先于运行期降级（mmd-adapter 守卫告警）暴露问题，正是 ADR-202 待办 6「vendor/fork 漂移防护」的部分落地 |
| node:fs 使用 | ✅ readFileSync(utf8) + existsSync 恰当，node 环境显式声明，无异步负担、无资源需释放 |
| 边界覆盖 | 🟡 全部为正向断言：缺「getter 未重复注入 / 恰好一次」负向校验，缺位置/类作用域断言（见 P3）；wasm 侧由 physics-contract 测试补齐，整体覆盖仍完整 |
| 可维护性 | 🟡 锚点常量与脚本重复定义且已漂移（见 P3），无共享来源；测试自身 60 行、职责单一、无魔法数值 |
| 实测 | ✅ `npm run test -- src/__tests__/vendored-patch.test.ts` → 3 passed（26ms）；`npm run check`（tsc）未跑，判断依据：本测试不触碰 src 类型面、改动面为零，基线全绿记录见 frontend/test-results.json |

**测试质量结论：良好（守护意图明确、层级正确、断言直击交付物），主要缺口是断言粒度为「存在性」而非「位置/唯一性」，以及注释契约随机制迁移而陈旧。**

---

审核日期：2026-08-15
审核员：子代理 round19-vendored-patch
