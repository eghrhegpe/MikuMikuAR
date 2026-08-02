# ADR-235: 保存机制现状与张力登记 —— 双权威源 / 同步写假设 / 全量 vs 增量 / 迁移不对称

> **状态**: ✅ 已完成（2026-08-02 落地登记 + Web 端退出兜底修复）
> **日期**: 2026-08-02
>
> **编号**: 235
>
> **关联**: [ADR-047](adr-047-config-persistence-coverage.md)（配置持久化覆盖现状——本 ADR 是其在保存机制架构维度的延伸）、[ADR-176](adr-176-web-desktop-dual-adapter.md)（Web/Desktop 双适配器——同步写假设断裂点）、[ADR-177](adr-177-web-loader-unification.md)（Web Loader 统一）、[ADR-234](adr-234-env-state-parity-guard.md)（env-state ↔ Go parity 防线——本 ADR 的发现源）、[ADR-198](adr-198-save-fault-tolerance.md)（保存分段容错）、[ADR-137](adr-137-envstate-single-source-schema.md)（EnvState 单一源）
>
> **来源**: 修复 mirror 几何持久化缺失（buglog `2026-08-02-mirror-geometry-persist-gap.md`）并落地 parity 防线（ADR-234）后，顺藤摸瓜对保存机制整体做了一次链路审阅，发现 4 个设计张力此前**从未被显式登记**——它们互不阻塞当前功能，但各自是潜在 bug 源或演进障碍。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-02

---

## 1. 背景：保存机制全景

持久化分两条存储、三条写入链路：

```
                        ┌─ 500ms 防抖 → persistEnvState → SetEnvState ─┐
 envState(148 字段) ─────┤                                            ├→ Go mergeEnvState → config.json.Env
                        └─ flushEnvState（隐藏/退出）──────────────────┘
 uiState ── 500ms 防抖 → flushUIState → SetUIState → config.json.UIState
 整场景 ── triggerAutoSave → 500ms 防抖 → saveSceneImmediate → SaveLastScene → last_scene.json
              └─ cleanupAndFlushSave（visibilitychange/beforeunload/Android ScreenLocked）同步兜底
```

现有防御层（状态良好，登记在案以防误删）：

| 防御 | 机制 | 位置 |
|------|------|------|
| 防抖合并 | `DebouncedTimer` 500ms，滑块连拖不狂写盘 | `env-persist.ts` / `scene-serialize.ts` |
| 退出兜底 | `cleanupAndFlushSave` 同步 serialize + dispatch | `scene-serialize.ts:1421` |
| 重入守卫 | `_saving`/`_savePending` 合并重叠保存 + `force` 出口路径 | `scene-serialize.ts:1361` |
| 恢复抑制 | `_suppressAutoSave` + `cancelEnvPersistTimer`，防恢复期级联覆盖 | `init.ts` / `scene-serialize.ts` |
| 写盘互斥 | Go `sceneMu` 锁防 last_scene.json 半写截断 | `scene.go:42` |
| 分段容错 | 单模型序列化抛错跳过不崩溃（ADR-198） | `scene-serialize.ts:351` |

## 2. 四个设计张力（本 ADR 核心登记内容）

### 2.1 张力一：env 是「双权威源」——依赖启动时序才不打架

启动恢复顺序（`init.ts:221-238`）：

1. `restoreEnvState()`：以 **config.json.Env** 为 authoritative 恢复
2. `tryRestoreLastScene()`：`deserializeScene(data, skipEnv=true)` 跳过 env，但随后（`scene-serialize.ts:1579`）**若场景文件含 env 则覆盖 config 的 env**

即 env 最终值 = 场景文件 env 覆盖 config env（**最后写入者获胜**），依赖两个事实才正确：
- `deserializeScene` 恢复期间 `_suppressAutoSave` 抑制了级联保存
- `cancelEnvPersistTimer()` 取消了恢复触发的 500ms 防抖回写

脆弱点：`restoreEnvState` 的防抖写入与 `LoadLastScene` 的时序竞争——若 `LoadLastScene` 延迟 > 500ms，恢复期间触发的 env 防抖会把**默认值**写回 config.json，污染下次启动的恢复源。已用 `cancelEnvPersistTimer` 打补丁（buglog 2026-07-16 教训 3），但补丁依赖对时序的精确理解。

**登记结论**：现状可用但脆弱。根治方向 = 明确「config 存启动默认 / 场景存快照，单向覆盖」或引入写入时间戳/版本号仲裁。属架构调整，需要独立子 ADR，暂不实施。

### 2.2 张力二：`cleanupAndFlushSave` 的「同步写盘」假设只对 Wails 成立

`scene-serialize.ts:1431-1435` 注释明确假设：**Go binding 调用在当前 tick 内同步完成写盘**。这对 Wails 成立（`SaveLastScene` 有 `sceneMu` 锁、写盘同步返回），但 **Web 端（ADR-176/177 browser-adapter）`SaveLastScene` 是 IndexedDB 异步事务**（`idbSet`），`beforeunload` 里 fire-and-forget 时事务可能来不及落盘——**网页端退出丢最后几秒场景**，此前无防护。

**本次修复（随本 ADR 落地）**：browser-adapter 的 `SaveLastScene` 改为**双写**——
- 主路径：IndexedDB `scenes/last_scene`（无 5MB 容量限制，正常读写路径）
- 同步镜像：`localStorage.setItem('mikumikuar:last_scene_mirror')`（**同步完成**，beforeunload 必落盘）
- `LoadLastScene` 优先读 IndexedDB，缺失时回退镜像
- 镜像失败（配额超限/不可用）静默忽略，主路径不受影响

### 2.3 张力三：全量 vs 增量持久化的取舍未显式决策

`persistEnvState` 每次发送**完整 148 字段** envState，Go 端 `mergeEnvState` 语义其实支持部分字段（`config.go:277` 注释明言"callers passing only a subset"）。全量的优势：

- **自愈**：某字段损坏会被整包修正
- 实现简单：无 diff 计算、无脏标记追踪

代价：滑块拖动时大对象频繁序列化（已有 `perf:save` 告警日志阈值 2ms）。当前 148 字段序列化约 1-2ms，未到瓶颈。

**登记结论**：维持全量是合理默认，但应视为**显式决策**而非无意选择——若未来字段数翻倍或 Web 端每次全量写 IndexedDB 变慢，应优先改「脏字段增量 + 定期全量自愈」而非直接加大防抖。

### 2.4 张力四：两套持久化的迁移机制不对称

| 载体 | 版本机制 | 迁移方式 |
|------|---------|---------|
| 场景文件（last_scene.json / 预设） | `version` + `migrateScene` 注册表 | 版本化演进（ADR-198） |
| config.json（Env/UIState） | **无版本号** | `UnmarshalJSON` 手工字段存在性判断（ADR-210/212 遗留） |

后果：config 侧字段改名/删除只能靠打补丁式 legacy 字段回填（`app.go:640` 已积累 9 个 legacy 映射），无法像场景文件那样版本化演进。长期维护成本会随改名次数线性上升。

**登记结论**：暂不重构（config.json 结构稳定，改名低频），但记录在案——下次 config 字段大改名时优先考虑引入 `version` + 注册表对齐场景文件机制。

## 3. 本次落地改动

| 文件 | 改动 |
|------|------|
| `frontend/src/core/backend/browser-adapter.ts` | `SaveLastScene` 双写 IndexedDB + localStorage 镜像；`LoadLastScene` 优先主路径回退镜像；新增 `LAST_SCENE_MIRROR_KEY` 常量 |

验证：`tsc --noEmit` 零错误。

## 4. 不在范围内（登记待办）

- **消除 env 双权威源**（张力一根治）：架构调整，需独立 ADR
- **config 迁移注册表化**（张力四根治）：待下次 config 字段大改名时评估
- **增量持久化**（张力三）：当前全量未到瓶颈，不进 backlog

## 5. 经验

1. **「同步写盘」假设是跨环境契约**：Wails 成立不等于浏览器成立。双实现（ADR-176/177）下，凡依赖"调用返回即落盘"的代码都需核对 browser-adapter 是否真同步——IndexedDB 事务天然异步。
2. **双权威源是最难 debug 的一类 bug**：两个"权威"在正常时序下等价，只在极端时序（延迟、竞态）下分叉——补丁只能打时序，根治必须消除双源。
3. **设计张力应显式登记**：4 个张力互不阻塞当前功能，若不留痕，下次重构时会重蹈覆辙（如本次 mirror 漂移就是 ADR-137 §3.4 承诺未落地所致）。
