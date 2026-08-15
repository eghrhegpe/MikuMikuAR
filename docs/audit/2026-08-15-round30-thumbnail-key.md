# round30 — thumbnail-key 双源对齐契约审核

**审核日期：** 2026-08-15
**审核员：** 子代理 round30-thumbnail-key（第 30 轮第 1 个测试）

## 审核范围

| 类别 | 文件 | 行号 |
|------|------|------|
| 测试文件 | `frontend/src/__tests__/thumbnail-key.contract.test.ts` | 1–121（全量） |
| 被测源码 | `frontend/src/scene/manager/thumbnail-key.ts` | 1–58（全量：thumbnailBaseKey / libraryModelBaseKey / buildThumbnailKey） |
| 被测源码 | `frontend/src/core/path.ts` | 100–108（isStageLike） |
| 写侧联动 | `frontend/src/scene/manager/model-loader.ts` | 153–158、211、631、807（captureThumbnail / thumbKey 构造） |
| 写侧联动 | `frontend/src/scene/manager/thumbnail-capture.ts` | 78–87（isStageLike → buildThumbnailKey → RT 尺寸） |
| 读侧联动 | `frontend/src/menus/library-core.ts` | 194–200（thumbnailKeyForModel） |
| 调用链 | `frontend/src/menus/library-actions.ts` | 354–359、380（libraryPath/innerPath 传参） |
| 专题 | `docs/audit/thumbnail-system.md` | L71、L238（P2「键值不一致」） |

**专题关系：** docs/audit/thumbnail-system.md L71（写侧 captureThumbnail 用 libraryPath、读侧仅用 m.file_path，ZIP 场景 key 失配）与 L238（统一 thumbnailKey 函数）所记载的 P2「键值不一致」已修复：写侧（model-loader.ts:211 `thumbnailBaseKey({libraryPath, filePath, innerPath})`）与读侧（library-core.ts:197–199 `libraryModelBaseKey(m)` + `buildThumbnailKey`）均收敛至 thumbnail-key.ts 唯一实现，本契约测试即该修复的防反弹熔断丝——任一侧漂移（baseKey 规则 / isStage 判定 / res/aspect 拼接）都会使本测试变红。

## 总体结论

✅ **通过**（0 项 P1 / 0 项 P2；2 项 P3 维护建议，不阻断）

## 亮点

- **双源收敛为单一实现（P2 根治）**：写侧 `model-loader.ts:211` 与读侧 `library-core.ts:197-199` 的 baseKey 与 key 拼接全部经 `thumbnail-key.ts:27/37/54` 三个唯一纯函数构造，从构造上消除「12 轮修改反弹」的双源字符串拼接；`thumbnail-key.ts:1-10` 头注释完整记录历史动机与 key 格式契约。
- **零依赖叶 / 无循环依赖**：`thumbnail-key.ts:12` 仅 `import type { LibraryModel } from '@/core/types'`（type-only，编译后擦除，无运行时依赖）；`path.ts:1-4` 为 ADR-191 零依赖叶，`isStageLike`（path.ts:106-108）为无依赖纯谓词。
- **纯函数天然并发安全**：三个导出函数均无模块级可变状态、无异步；写侧并发生成竞态由 `model-loader.ts:159` 的 `_thumbCaptureGen` 计数守卫，key 推导侧无共享状态。
- **契约测试写侧模拟真实**：`thumbnail-key.contract.test.ts:49` 用解压临时路径 `/tmp/${...}`（≠ libraryPath）构造写侧 filePath，精确还原 ZIP 场景「库引用路径 ≠ 实际路径」这一历史失配前提，断言 `writeKey === readKey` 逐字节相等（:72，`toBe` 严格字符串比较，非宽松匹配）。
- **六象限用例矩阵**：actor / stage / prop × file / zip 全覆盖（:35-42），配 `thumbnailBaseKey` 规则单测（libraryPath 优先 / 回退 filePath / zip 追加 innerPath / 相等去冗余，:78-99）与 `buildThumbnailKey` 规则单测（aspect 双向 / resolution 缺省 512 / 分辨率独立，:103-120）。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/scene/manager/thumbnail-key.ts` | :56 | aspect 语义常量三处独立重复：`thumbnail-key.ts:56`（'16/9'/'2/3' key 字符串）、`thumbnail-capture.ts:81`（16/9、2/3 数值，驱动 RT 渲染尺寸）、`library-core.ts:375`（thumbAspect 字符串，驱动 UI 面板）。key 拼接虽已收敛，但改比例需三处同步，存在漂移窗口 | 在 thumbnail-key.ts 导出唯一 aspect 常量表（如 `ASPECT_LANDSCAPE`/`ASPECT_PORTRAIT` 含字符串与数值），三处统一引用 |
| 🟡 P3 | `frontend/src/__tests__/thumbnail-key.contract.test.ts` | :34 | 注释引用 `library-actions.ts:299` 已行号漂移（现为空行）；实际传参为 :354-359（zip 分支 `libraryPath: m.file_path`）与 :380（非 zip 分支未传 libraryPath）。另注释「libraryPath 恒等于 m.file_path」措辞过度概括：非 zip 分支是 libraryPath 缺省 → 回退 filePath（= m.file_path），机制等价但描述不精确 | 更新注释为精确行号与两分支语义（zip：libraryPath 恒等于 m.file_path；非 zip：缺省回退，filePath 恒等于 m.file_path） |
| 🟢 P4 | `frontend/src/scene/manager/thumbnail-key.ts` | :55 | `buildThumbnailKey` 的 resolution 无合法性校验，NaN/0/负值直接拼入 key 字符串；渲染侧 RT 尺寸有 `Math.max(1, ...)` clamp（thumbnail-capture.ts:86-87），key 与渲染尺寸存在语义缝隙（写读两侧同值故不 miss） | 可选：对 resolution 做 `Number.isFinite` + 正整数守卫或 clamp 后拼接 |
| 🟢 P4 | `frontend/src/__tests__/thumbnail-key.contract.test.ts` | :30 | `libModel` 工厂以 `as LibraryModel` 收窄（测试代码类型断言；生产代码 0 处 `as any`/`@ts-ignore`） | strict:false 现状下可接受；可选改用 `satisfies` 或显式字段校验提升测试侧类型精度 |
| 🟢 P4 | `frontend/src/__tests__/thumbnail-key.contract.test.ts` | :35-42 | 契约用例未锁「container=zip 且 zip_inner 为空」边界（当前写读两侧一致忽略空 innerPath，防御性缺口） | 可选追加一个 `zip_inner: ''` 用例锁定该边界行为 |

## 测试质量评价

- **断言有效性** ✅：核心契约以 `toBe` 做写读两侧 key 逐字节相等（:72）；规则单测全部为精确字符串断言（:79-99、:104-120），无 `toBeTruthy`/空 `not.toThrow` 类空洞断言。
- **场景覆盖** ✅：六象限矩阵（actor/stage/prop × file/zip）+ libraryPath 优先/回退/去冗余 + zip 追加 + aspect 双向 + resolution 缺省与独立；`isStageLike` 判定另在 `config.test.ts:291-300` 有单测（stage/scene→true，pmx/vmd/''→false）。
- **跳过测试** ✅：0（grep `.skip`/`.todo`/`.only`/`xit`/`xdescribe` 无匹配）。
- **可维护性** ✅：用例驱动数据表 + `libModel` 工厂，新增象限仅需一行 case；文件头注释完整记录契约语义（写侧 model-loader 视角 vs 读侧 library-core 视角）。
- **验证结果** ✅：`cd frontend && npm run test -- src/__tests__/thumbnail-key.contract.test.ts` → **12/12 通过**（28ms，Vitest 4.1.9）；`npm run check`（tsc --noEmit 全量类型检查）→ **通过**（16.3s，exit 0，无新增错误）。审核焦点（契约收敛 + 测试有效性）已由测试全绿 + 全链调用点核实（library-actions.ts → load-manager.ts:165-170 → model-loader.ts:631/807 → thumbnail-key.ts）闭合。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round30-thumbnail-key
