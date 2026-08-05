---
kind: review_playbook
name: 大模块审核子代理流水线（复刻自 ysm-model-manager）
tier: architecture
category: core
scope:
  - docs/audit/
adr:
  - ADR-238
use_when:
  - 子代理审核
  - 大模块审查
  - 并行发散审查
  - 思维链隔离
---

# 大模块审核子代理流水线 Playbook（MikuMikuAR 版）

> **来源**：复刻自 `ysm-model-manager/docs/review/subagent-review-playbook.md`（2026-08-05 实跑验证后适配本仓基建）。
> **适用范围**：单模块 / 跨模块大范围代码审核（>500 行），主模型上下文有限、需要并行发散审查的场景。
> **核心约束**：消化「子代理与主模型思维链不互通」——子代理推理对主模型不可见，主模型只拿到结构化报告。

---

## 1. 核心约束与两类风险

子代理（Agent 派生的 general-purpose 子进程）拥有独立上下文，推理链对主模型不可见，主模型只拿到最终结构化报告。风险：

- **风险 A（误信）**：子代理产出「看似合理但未经核实」的结论，主模型照单全收。
- **风险 B（失焦）**：自由发散产出大量低相关意见，淹没真问题。

对策：①限定上下文（只喂 `source_files` + 知识卡 + rubric，不喂主模型自己的分析）②结构化输出契约 ③主模型独立 verify ④共享真相源（当前源码 + 知识卡）。

## 2. 流水线（4 阶段，工具映射为 MikuMikuAR 版）

### Phase 0 — 知识库健康度诊断（主模型执行）
```bash
npm run check:docs      # 知识卡 symbols / 漂移 / reverse 缺口（替代隔壁 doctor.mjs）
npm run check:funcmap   # 函数索引同步（替代隔壁 funcmap.mjs）
git status --short      # 确认工作区（他人改动不影响审核结论，但需知悉）
```
通过标准：知识卡 0 漂移、funcmap 同步。若有漂移先修（自动生成文件直接 gen 修复）。

### Phase 1 — 固化发散种子（主模型执行）
隔壁用 `ai-mistake-tracker.mjs`（本仓无）→ **映射为 buglog 反模式锚**：
```bash
ls -t docs/buglog/ | head -12          # 近期 bug
head -12 docs/buglog/<近期文件>.md     # 提取反模式分类（状态多源/资源泄漏/条件失效/告警门控...）
grep -n "> \*\*状态\*\*" docs/adr/*.md | grep -iE "规划|实施中"  # 进行中 ADR 的已知坑
```
把反模式分类 + 文件热点作为子代理 prompt 的优先关注项。

### Phase 2 — 以知识卡为单元扇出（主模型派发子代理）
用 `docs/knowledge/index.md` 枢纽 + `routes.md` 路由定位知识卡，**每个知识卡 = 一个扇出单元**。子代理 prompt 模板见 §4。
- 子代理**只读**（general-purpose，prompt 明确禁止改文件/跑构建）。
- 并行派发多个子代理，各自独立。

### Phase 3 — 聚合对账（主模型收口）
1. 子代理报告按固定格式回填（总体结论 → 亮点 → 风险表 P1–P4 → 类型安全 → 数据流追踪 → 知识卡漂移）。
2. 主模型**去重** + **P1/P2 全量 verify**（grep/read 源码独立确认）。
3. **价值性复核**（本仓增强，见 §5）：verify 不只确认「现象存在」，还要判断「是否是真缺陷」——区分事实层与判断层。
4. 汇总成统一审核报告（格式参考 `docs/audit/2026-08-05-validation-library-core.md`）。

## 3. 审核 rubric（喂给子代理）

**5 维度**：类型安全（undefined/null 守卫、无隐式全局、裸 as 需注释）/ 资源管理（事件订阅配对、`new Xxx()` 有对应释放、observer 在 dispose 移除）/ 测试覆盖（核心逻辑有单测）/ 功能正确性（并发守护、undefined 守卫、Promise 不丢弃、finally 必走）/ 设计质量（状态来源唯一、副作用可追踪、职责边界）。

**4 思维模型**：数据流追踪（状态从哪来/谁改/流到哪，标注幽灵路径）/ 生命周期完整性（创建与销毁同抽象层配对）/ 并发与边界（快速连点、异步过期标记、竞态）/ 异常契约（catch 后状态一致、finally 覆盖、Promise 不静默吞错）。

## 4. 子代理 prompt 模板（bounded + structured）

```
你执行单模块只读代码审查，禁止修改任何文件、禁止运行构建/测试命令。
你的上下文与主模型完全隔离，只接收本 prompt 内容。完成后仅返回结构化报告。

TARGET（完整读取）：
- <source_files 来自知识卡>

SHARED GROUND TRUTH（读取知识卡；以当前源码为终极真相，冲突只报告漂移不盲信）：
- docs/knowledge/<card>.md

REVIEW RUBRIC：<粘贴 §3 的 5 维度 + 4 思维模型>

PROJECT ANTI-PATTERNS（优先关注，来自 docs/buglog 与近期修复）：
- <粘贴 Phase 1 提取的反模式分类与文件热点>

OUTPUT FORMAT（仅返回结构化报告，不披露工具链）：
1. 总体结论：(通过/有条件通过/不通过) + 一句话理由
2. 亮点：(bullet，最多 3 条)
3. 风险表：等级(P1-P4) | 位置 file:line | 现象 | 处置建议
4. 类型安全：结论 + 关键发现
5. 数据流追踪：列出关键状态的所有写入方，标注幽灵路径
6. 知识卡漂移：是/否 + 具体不符点
务必给 file:line，禁止编造行号；不确定时写 ≈行N。
```

## 5. 主模型对账协议（verify + 价值性复核）

- 对子代理报告的每个 **P1/P2**，主模型必须亲自 `Read`/`Grep` 源码确认；**P3/P4 抽样**。
- verify 分两层：
  - **事实层**：「现象是否真实存在」「位置是否准确」——grep/read 直接确认。
  - **价值层**：「这算不算缺陷」——核实组件/API 自身的契约（如组件是否设计了 dispose 方法却被调用方丢弃；模块是否有充分消费锚点）。**现象存在 ≠ 需要修**，判断层必须主模型自己做。
- 发现子代理误报：标注「主模型复核未证实」并说明原因。
- 发现知识卡漂移：同步修卡（消除漂移，不静默假定卡片正确）。

## 6. 风险与权衡

| 项 | 说明 | 缓解 |
|---|---|---|
| 子代理误报 | 隔离上下文可能产出未经核实结论 | Phase 3 事实层 + 价值层双重 verify |
| 发散失焦 | 自由发散产噪音 | Phase 1 反模式锚定 |
| 确认偏误 | 锚定让子代理带着预设立场放大误报 | 反模式锚仅作「优先关注」，verify 时对锚相关结论加严 |
| 子代理上下文溢出 | 给整仓会淹没信号 | 只给 `source_files` + 知识卡 |
| 聚合偏见 | 主模型只看摘要漏真问题 | P1/P2 全量 verify，不回抽样 |
| 成本未量化 | 每模块 1 子代理 + verify 重读源码 | 仅 >500 行大模块走流水线；轻量模块直接审 |

## 7. 验证先例

`docs/audit/2026-08-05-validation-library-core.md`：`library-core.ts`（1020 行）实跑本流水线，子代理 9 项结论经主模型独立 verify，**6 项完全证实、2 项现象证实但价值性存疑、1 项未复核（命中率 7/9）**；2 个 P3 泄漏（renderGridMode/onSelect 未 dispose panel）确认为真缺陷，知识卡 4 处漂移全部证实。
