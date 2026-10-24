# 功能性审核报告 · round-76b（TS core/backend ×6 + resource-warning-sink ×1 + scene ×7）

> 日期：2026-10-25 ｜ 审核范围：14 个测试文件 ｜ 子代理：TS core/backend + scene 功能性审核
> 方法：逐文件通读测试 → 交叉核对被测源码 → 单文件测试验证（未跑全量套件，未执行任何 git 命令）

---

## 一、总体结论

**12 PASS / 2 有缺陷（覆盖缺口）**。全部 14 个文件单文件测试通过（111/111 用例）。

- 断言整体扎实：backend 系 6 文件的期望值与 `browser-adapter.ts` 源码语义逐一核对一致（_classifyPath / _resolveIdbKey / IsolateModelDir / ListDirRecursive / GetCacheStats / _listModels 全部对上）；scene/transform 4 文件的 mock 隔离（vi.hoisted + vi.resetModules）符合 ADR-219/262 卫生铁律。
- **唯一 P2**：`ingestModelFiles` 批量摄入的**同批内同名 PMX 互相覆盖**——源码在批量写库前逐个解析唯一 stem，而 ADR-182 的后缀冲突检测只查 IDB 既有 entry、不查同批已解析 stem，导致同批同名文件静默覆盖（第二个 byte 永久丢失）；调用链 `settings-downloads.ts` 可达（下载文件夹子目录同名 PMX，f.name 仅取 basename）。测试文件缺该用例，缺陷被掩盖。
- 无 P1（未发现直接导致错误的已实现逻辑缺陷；P2 为「保护机制在批量路径被绕过 + 测试盲区」组合）。
- P3 × 6、P4 × 6，均为覆盖缺口 / 断言弱化 / 漂移风险，见风险表。

## 二、亮点

1. **`frontend/src/scene/transform/transform-selection.test.ts:13-20`**：beforeEach 中 `getGizmoTargetId.mockReturnValue(null)` + 注释明确记录「vi.mockReset 后返回 undefined 而非 null，会误触发 syncDragMode 同目标分支」的回归防线——是全 round 最值得固化的 mock 陷阱注释。
2. **`frontend/src/scene/transform/transform-mode.test.ts:10-27`**：`vi.hoisted` + `vi.resetModules` + localStorage 预置的组合模式，干净地隔离了模块加载期读取的存储初始态（ADR-219 合规范本）。
3. **`frontend/src/core/backend/backend.resolve.test.ts:1-21`**：顶层捕获 `realWindow` + afterEach 恢复（ADR-219 window 恢复铁律），且 `vi.resetModules` 每测重置 backend 单例（_resolved/_resolving），单例污染防护到位。
4. **`frontend/src/scene/manager/texture-fallback.test.ts`（15 用例）**：候选顺序 [裸名, 首段+名, 去首段]、declared 别名 basename 大小写不敏感 first-file-wins、expand 去重共享 data 引用——与源码 1:1 一致，无过度断言。
5. **shared mock 复用**：backend 系 6 文件全部复用 `backend-mocks.ts`（makeIdbMock）/ `browser-adapter-mocks.ts`（per-store mem Map），无内联差异化形状（ADR-219 第 2 条合规）。
6. **`frontend/src/core/backend/browser-adapter.ingest.test.ts:94-106`**：同名 PMX **顺序**摄入冲突用例验证了「first-wins + 后缀 (2)」语义，是 P2 缺口的最佳对照——差一个「同批」用例。

## 三、风险表

| # | 等级 | 文件 | 位置 | 观察 | 建议 |
|---|------|------|------|------|------|
| 1 | 🟠 P2 | `frontend/src/core/backend/browser-adapter.ingest.test.ts` + `frontend/src/core/backend/browser-adapter.ts` | ingest 测试:74-106（缺同批用例）；源码:663-673（ingestModelFiles）、587-624（_buildIngestPairs pmx 分支）、565-573（_resolveUniqueStem） | `ingestModelFiles` 先逐文件 `_buildIngestPairs`（L667-670）再一次性 `idbBatchSet`（L671）。_resolveUniqueStem 只查 IDB 既有 `entry:<enc>`，**不查同批已解析出的 stem**：同批两个同名 PMX 都解析出 'miku' → 键 `file:miku`/`entry:miku` 重复，后者覆盖前者，且 L672 返回 `files.length`（全部计成功）。ADR-182 注释（L562「防止 FSA 多选同名 PMX 覆盖」）声称的保护在批量路径失效。可达性：`frontend/src/menus/settings-downloads.ts:81`（listFilesWeb 递归只取 basename 为 f.name）+ L169-178（_ingestedStems 只做跨批去重，同批同名两者都进 modelFiles）+ L183（`ingestModelFiles(modelFiles)`） | 源码修复（主模型实施）：① `browser-adapter.ts:565` 改 `_resolveUniqueStem(baseStem, reserved?: Set<string>)`，while 条件追加 `\|\| (reserved?.has(stem) ?? false)`，命中后 `reserved?.add(stem)`；② `browser-adapter.ts:587` `_buildIngestPairs` 增加 reserved 透传；③ `browser-adapter.ts:663-673` ingestModelFiles 内建 `const reserved = new Set<string>()` 并在每个 pmx 解析后注册 stem。测试补 `browser-adapter.ingest.test.ts`：`ingestModelFiles([{name:'miku.pmx',bytes:A},{name:'miku.pmx',bytes:B}])` → 期望 `file:miku`=A、`file:miku%20(2)`=B、`entry:miku%20(2)` 存在。理由：恢复 ADR-182 后缀语义至批量路径，消除静默数据丢失 |
| 2 | 🟡 P3 | `frontend/src/scene/transform/transform-adapter.test.ts` | 测试:7-39（仅覆盖 registry）；源码:`transform-adapter.ts:74-88` | 本模块唯一编排入口 `attachGizmoForKind` 完全未测：缺 adapter→false（L77-79）、缺 node→false、attachGizmo 回调接线（onPositionDragEnd 必传，onRotation/ScaleDragEnd 条件传 undefined，L80-87） | 补 3-4 用例：stub adapter + mock `attachGizmo`（该模块从 transform-gizmo re-export，vi.mock '@/scene/transform/transform-gizmo'），断言 false 分支与回调绑定参数 |
| 3 | 🟡 P3 | `frontend/src/scene/ar/ar-webxr-probe.test.ts` | 测试:31-106（只测纯函数）；源码:`ar-webxr-probe.ts:68-94,96-113,115-150,255-331,333-395` | 5 个副作用函数未覆盖：probeAndroidWebView（wails 回调 Promise）、checkSessionSupported、probeFeaturesBySession、probeWebXR（含 `_cachedResult` 缓存语义 L255-331——缓存是否按条件失效无护栏）、probeWebXRFeatures | 至少补 probeWebXR 的缓存路径（同参数二次调用不重探 / 不同 platform 清缓存）与 probeAndroidWebView 的 wails 缺失早退（L70）；纯函数已覆盖，缺口聚焦副作用与缓存 |
| 4 | 🟡 P3 | `frontend/src/core/resource-warning-sink.test.ts` | 测试:24-57；源码:`resource-warning-sink.ts:24,27-29` | `_flush` 两条分支未测：① count>8 时 detail 截断为前 8 条 + ` …+${count-8}`（L24 三元）；② showInfoToast 抛错时降级为仅 logWarn（L27-29 catch） | 补 2 用例：9+ 条不同消息断言 toast 第二参含 '…+N'；vi.mocked(showInfoToast).mockImplementation(throw) 断言不冒泡且 logWarn 仍被调 |
| 5 | 🟡 P3 | `frontend/src/core/backend/backend.resolve.test.ts` | 测试:86-104（timeout 用例）；源码:`index.ts:89-109` | timeout 用例在 dev=500ms / prod=3000ms 两种环境下都通过（advance 4000ms 兜底），**无法锁定 import.meta.env.MODE 分支（L92）选对了超时值**；go-adapter import 失败 catch 降级 browser（L105-109）与 `_resolving` 并发去重（L34/95）未测 | 用例中 mock import.meta.env.MODE 区分 dev/prod，分别 advance 499/2999ms 断言未 resolve、500/3000ms 断言降级 browser；catch 路径：vi.mock go-adapter 工厂抛错后断言 resolveBackend→browser + logWarn |
| 6 | 🟡 P3 | `frontend/src/core/backend/browser-adapter.fsa-conflict.test.ts` | 测试 writeSimulatedImport helper（~L20-60）；源码:`browser-adapter.ts:684-730`（_writeModelWithTextures） | helper 手工复刻生产 `_writeModelWithTextures` 的键形状（file:/entry:/dir:<enc>:<tex>），而非复用生产函数——生产键形状若演进（如加 outfit: 前缀），helper 漂移导致冲突用例「假通过/假失败」 | 建议 helper 内对键形状加 1 条形状断言护栏，或直接经 `_writeModelWithTextures` 导出路径写入（若可注入）；短期在 helper 头注释标注「同步自 browser-adapter.ts:684，改动需两边同步」 |
| 7 | 🟡 P3 | `frontend/src/menus/settings-downloads.ts`（P2 关联调用侧，非本 round 14 文件） | :195-205 + :169-171 | 同名 zip 同批盲点：L169/L174 的 `_ingestedStems.has(f.name)` 只在 push 前检查（跨批去重），同一扫描批次内两个同名 zip 都进 zipTasks → L197 顺序 idbSet last-wins；源码 L625 注释称 zip「由上层管理」但上层未管 | 与 P2 一并修：zip 批次内按 name 去重（先入 zipTasks 者胜，后入跳过并 fail++ 或 continue） |
| 8 | 🟢 P4 | `frontend/src/core/backend/backend.update.test.ts` | 测试:14-41；源码:`browser-adapter.ts:1530-1550` | ① DownloadAndRunInstaller（L1548-1550，与 DownloadApk 同形）未测；② toHaveProperty 多数只断键存在，未断值（current/latest==='web'、checkedAt===0、size===0） | 补 DownloadAndRunInstaller 用例 + 把 8 键改为 toEqual 全值断言 |
| 9 | 🟢 P4 | `frontend/src/scene/transform/transform-pick.test.ts` | 测试:55-74；源码:`transform-pick.ts:47-49,57-62` | 未覆盖：① `pickInfo={hit:true, pickedMesh:null}` → `!pickInfo.pickedMesh` 早退 null；② tryAttachGizmoFromPick 中 `getGizmoTargetId()` 返回**不同** id（非 null 非同目标）→ 走 attach 分支 | 各补 1 用例 |
| 10 | 🟢 P4 | `frontend/src/scene/transform/transform-mode.test.ts` | 测试:18-57；源码:`transform-mode.ts` | 未覆盖：存储值 '0' → 初始 false；无效值（'x'）→ false；setDragModeEnabled(false) 同值早退不写 localStorage | 补 3 个轻用例 |
| 11 | 🟢 P4 | `frontend/src/scene/manager/pmx-texture-audit.test.ts` | 测试:40-64；源码:`pmx-texture-audit.ts`（parse 后二次 abort 复查） | 测了 parse 前 abort（断言 ParseAsync 未调），未测「parse 完成后复查 signal.aborted → 返回 []」分支 | 补 1 用例：ParseAsync 完成时 abort 标志置 true |
| 12 | 🟢 P4 | `frontend/src/core/backend/browser-adapter.ingest.test.ts` | :74 测试标题 | 标题/注释「且不触发 loadManager.load」无对应断言（loadManager 未 mock、无从断言）——注释过度承诺 | 删该短语或改为注释说明「批量路径设计上不接线 loadManager，见 ADR-195」 |
| 13 | 🟢 P4 | `frontend/src/core/backend/browser-adapter.fsa-conflict.test.ts` + `backend.virtual-dir.test.ts` | 两处均无 | _resolveUniqueStem 跳号行为（已存在 'miku' 与 'miku (3)' → 新导入取 'miku (2)' 而非 '(4)'）未测 | 补 1 用例（fsa-conflict 侧） |

## 四、逐文件结论

| 文件（完整路径） | 用例 | 结论 | 备注 |
|---|---|---|------|
| `frontend/src/core/backend/backend.resolve.test.ts` | 5/5 通过 | **PASS（有 P3 缺口）** | 单例 reset + ADR-219 window 恢复合规；缺口：dev/prod 超时未锁定、catch 降级与 _resolving 去重未测（风险 #5） |
| `frontend/src/core/backend/backend.update.test.ts` | 2/2 通过 | **PASS（有 P4 缺口）** | CheckForUpdate/DownloadApk 常量形状与源码 L1530-1547 一致；DownloadAndRunInstaller 与全值断言缺失（风险 #8） |
| `frontend/src/core/backend/backend.virtual-dir.test.ts` | 9/9 通过 | **PASS** | IsolateModelDir 幂等 + ListDirRecursive 精确前缀/bare-stem fallback + readFileBytes 主键→canonical→scoped→flat 四级回退，期望与源码逐一核对一致 |
| `frontend/src/core/backend/browser-adapter.fsa-conflict.test.ts` | 6/6 通过 | **PASS（有 P3/P4 缺口）** | 扫描/手动导入双命名空间互不冲突验证完整；helper 形状漂移风险（风险 #6）+ 跳号未测（风险 #13） |
| `frontend/src/core/backend/browser-adapter.ingest.test.ts` | 4/4 通过 | **有缺陷（P2 覆盖缺口）** | 顺序冲突用例优秀（风险表#6 对照），但缺同批同名用例，掩盖源码批量覆盖缺陷（风险 #1）；标题注释过度承诺（风险 #12） |
| `frontend/src/core/backend/browser-adapter.texture-collision.test.ts` | 4/4 通过 | **PASS** | 模型 dir 命名空间隔离（dir:A%2Fmiku: 前缀）+ GetCacheStats 计数口径（仅 Uint8Array 计字节、entry 对象不计）与源码 L1768-1805 一致 |
| `frontend/src/core/resource-warning-sink.test.ts` | 3/3 通过 | **PASS（有 P3 缺口）** | 400ms 防抖 + 去重 + logWarn 并行验证；>8 截断与 toast 抛错降级未测（风险 #4） |
| `frontend/src/scene/ar/ar-webxr-probe.test.ts` | 17/17 通过 | **PASS（有 P3 缺口）** | 纯函数（detectPlatform/buildVerdict/formatProbeReport）覆盖全面、期望字符串与源码逐字一致；副作用函数与缓存未测（风险 #3） |
| `frontend/src/scene/manager/pmx-texture-audit.test.ts` | 5/5 通过 | **PASS（有 P4 缺口）** | parse 前 abort + 路径归一化（\→/ + 大写）+ catch 非阻断验证完整；parse 后二次复查分支未测（风险 #11） |
| `frontend/src/scene/manager/texture-fallback.test.ts` | 15/15 通过 | **PASS** | 候选顺序/别名/expand 去重与源码 1:1，本 round 断言密度最高文件（亮点 #4） |
| `frontend/src/scene/transform/transform-adapter.test.ts` | 4/4 通过 | **有缺陷（P3 覆盖缺口）** | 仅测 registry 四操作；模块核心入口 attachGizmoForKind（transform-adapter.ts:74-88）零覆盖（风险 #2） |
| `frontend/src/scene/transform/transform-mode.test.ts` | 6/6 通过 | **PASS（有 P4 缺口）** | 存储持久化 + 早退 + scheduleRefresh 验证完整，隔离模式为范本（亮点 #2）；'0'/无效值初始态未测（风险 #10） |
| `frontend/src/scene/transform/transform-pick.test.ts` | 17/17 通过 | **PASS（有 P4 缺口）** | 元数据父链/谓词/attach 编排覆盖好；pickedMesh:null 与不同 id 分支未测（风险 #9） |
| `frontend/src/scene/transform/transform-selection.test.ts` | 14/14 通过 | **PASS** | pending-retry 状态机 + 加载刷新钩子注册全覆盖，getGizmoTargetId undefined/null 陷阱注释为本 round 最佳实践（亮点 #1） |

## 五、验证记录

- **单文件测试**（`cd frontend && npm run test -- <路径去 frontend/ 前缀>`，14 次独立进程运行）：**14/14 文件通过，111/111 用例通过，0 失败**。耗时：首跑冷启动 ~8s，其后每文件 <3s。
- **断言核对**：browser-adapter.ts（2557 行）按 500 行先 grep 后读规则定位 12 个关键区段（_classifyPath/_resolveIdbKey/_resolveUniqueStem/_buildIngestPairs/_writeModelWithTextures/readFileBytes/CheckForUpdate/GetCacheStats/GetLibraryIndex/IsolateModelDir/ListDirRecursive）逐一与 6 个 backend 测试期望比对，无错配。
- **P2 可达性验证**：`settings-downloads.ts:63-95`（listFilesWeb 递归 basename）+ :157-183（同批同名进入 modelFiles）+ :183（ingestModelFiles 调用）三段连读确认数据丢失路径成立。
- **合规声明**：未执行 git 命令；未改动 .githooks / test-files.txt；源码与测试零改动（只读）；唯一新建文件为本报告。