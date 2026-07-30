# ADR-211: 命名 vs 翻译 vs 实际功能错位系统审计与治理

- **状态**: 📝 规划
- **日期**: 2026-07-30
- **相关**: ADR-029（物理 UI 重构）、ADR-035（设置差距分析）、ADR-120（环境预设分类化）、ADR-128（镜面重命名）、ADR-132（全局明暗基准）、ADR-137（EnvState 单一源 Schema）、ADR-138（env-dispatcher 破循环）、ADR-146（函数重复分类）、ADR-172（湿身效果）、ADR-195（下载文件夹统一）、ADR-209（月亮天体）、ADR-210（环境光照字段重命名）
- **源码锚点**: `scene/env/env-gravity.ts`、`scene/env/env-wetness.ts`、`scene/env/env-noise.ts`、`scene/env/env-lighting.ts`、`scene/render/lighting-sun.ts`、`scene/env/env-bridge.ts`、`core/env-state-schema.ts`、`core/i18n/locales/zh-CN.ts`、`core/i18n/locales/en.ts`

---

## 一、审计方法

本次审计通过交叉比对三套数据源进行：

| 数据源 | 覆盖范围 | 比对方式 |
|--------|---------|----------|
| **英文翻译包** | `locales/en.ts` — 2098 行，~800 个 key | 提取每个 key 的英语字面语义 |
| **中文翻译包** | `locales/zh-CN.ts` — 2068 行，~800 个 key | 提取中文翻译，标记中英混杂/漏译 |
| **源码实现** | 20+ 核心文件（env-*、lighting-*、render、env-state-schema） | 逐字段/变量追踪实际功能 |

最终识别出 **38 个具体问题点**，归入 8 组模式，本 ADR 逐组展述。

---

## 二、分组详情

### 2.1 名窄实宽——命名暗示窄于实际功能

> 变量名/翻译只说"天空"/"角度"等局部概念，实际控制了全场景光照。

| # | 符号 | 命名暗示 | 实际控制范围 | 源码证据 |
|---|------|---------|-------------|---------|
| 1 | `skyColorTop/Mid/Bot` | 天空渐变三色 | `deriveLighting()` → `dirDiffuse`（方向光色）/ `dirIntensity` / `hemiIntensity`（半球光强）/ `scene.ambientColor` | `env-lighting.ts:56-98` + `env-bridge.ts:59-78` |
| 2 | `sunAngle`（-15~90） | 太阳角度 | 同上，方向光的**强度、方向、半球补偿**全部由这个浮点数决定 | `env-lighting.ts:64-73,87-95` |
| 3 | `azimuth`（默认 -45°） | 太阳方位角 | 决定方向光入射方向（`dirDirection: [x,y,z]`）→ 阴影落点 | `env-lighting.ts:89-95` |
| 4 | `iblIntensity` | IBL 环境反射强度 | 实际还参与 `scene.ambientColor` 推导（间接光） | `env-bridge.ts:70-79` + `env-state-schema.ts:48` |
| 5 | `globalBrightness` | 全局明暗标量 | 被归入 `'sky'` dispatch 组，修改 `skyColor` 时触发重烘焙，命名说"全局"但 dispatch 说"和天空绑一起" | `env-state-schema.ts:50` |

### 2.2 文件/函数名与职责错位

> 文件名表达了 X 概念，实际做的是 Y 甚至 X+Y。

| # | 文件 | 名字 | 实际功能 |
|---|------|------|---------|
| 6 | `env-gravity.ts` | 环境重力 | 重力 + `setCollisionEnabled()` / `setBodyCollisionEnabled()` / `setGroundCollisionEnabled()` |
| 7 | `env-wetness.ts` | 环境湿度 | 材质淋湿视觉效果（改 roughness/specular），非物理湿度 |
| 8 | `env-noise.ts` | 环境噪音 | `hash2` / `hash2v` / `valueNoise` — 纯数学工具函数 |
| 9 | `settings.perf.vsync` | 垂直同步（VSync） | 实际是 babymmd 渲染帧率上限控制，浏览器自带 VSync 无关 |

### 2.3 Schema 分组与实际触发链路脱节

> EnvState 字段的 `group` 声明与运行时行为不一致，导致写状态不回显。

| # | 字段 | Schema `group` | 后果 |
|---|------|---------------|------|
| 10 | `collisionEnabled` | **无 group** | `setEnvState({ collisionEnabled: false })` → 只存状态、不触发 dispatch、碰撞不关 |
| 11 | `bodyCollisionEnabled` | 无 group | 同上 |
| 12 | `groundCollisionEnabled` | 无 group | 同上；`env-gravity.ts` 里 `setGroundCollisionEnabled()` 走的是独立 setter 路径 |
| 13 | `timeOfDayActive` | 无 group | `startTimeOfDay()` 间接改 `sunAngle` 才触发 sky 组；直接写 `envState.timeOfDayActive` 无反馈 |
| 14 | `timeOfDaySpeed` | 无 group | 只影响内部 tick 步长，不触发任何子系统回调 |
| 15 | `groundPreset` | 无 group（注释说"纯 UI 标记"） | 注释说明"不得进 _GROUND_KEYS"——之前踩过坑 |

### 2.4 翻译缺失/中英混杂/漏译

| # | Key | 英文值 | 中文值 | 问题 |
|---|-----|--------|--------|------|
| 16 | `settings.paths.environment` | `'Environment'` | `'Environment'` | ❌ 全英文未翻 |
| 17 | `settings.paths.mdDress` | `'MD Dress'` | `'MD Dress'` | ❌ 全英文未翻 |
| 18 | `settings.paths.setting` | `'Setting'` | `'Setting'` | ❌ 全英文未翻 |
| 19 | `settings.paths.audio` | `'Audio Music'` | `'Audio 音乐'` | ⚠️ 中英混杂 |
| 20 | `settings.paths.prop` | `'Prop'` | `'Prop 道具'` | ⚠️ 中英混杂 |
| 21 | `settings.paths.stage` | `'Stage'` | `'Stage 场景'` | ⚠️ 中英混杂 |
| 22 | `model-detail.fComment` | `'Readme（readme）'` | `'使用规约（readme）'` | ⚠️ 英文值中"Readme"与"readme"重复 |

### 2.5 命名过于泛化/模糊

| # | Key | 英文 | 中文 | 问题 |
|---|-----|------|------|------|
| 23 | `motion.autoSwitch` | `'Auto Switch'` | `'自动切换'` | 切换什么？从上下文才知是 procedural motion 模式切换 |
| 24 | `motion.intensity` | `'Intensity'` | `'动作强度'` | 英文裸用 Intensity，中文加了"动作"限定——中文比英文清楚 |
| 25 | `motion.speed` | `'Speed'` | `'速度'` | 是播放速度还是骨骼微动速度？裸"Speed"无域 |
| 26 | `param.pitch/yaw/roll` 与 `motion.foot.pitch/yaw/roll` | 同上但多上下文 | "屈腕/摆腕/转腕" vs "足背屈/足内旋/足侧翻" | 同一批英文词，两套中文翻译 |

### 2.6 VSync 假名

| # | Key | 当前文案 | 实际真相 |
|---|-----|---------|---------|
| 27 | `settings.perf.vsync` | 英文 `'Frame Rate Limiter'`（UI 已纠正）但 **key 名仍是 `vsync`** | 不是垂直同步。hint 明文："浏览器/WebView 渲染自带垂直同步效果，故无垂直同步设置" |

### 2.7 翻译风格不统一

路径 `settings.perf.*` 中，部分渲染效果加英文注释，部分纯中文直译：

| 纯中文 | 中文+英文注释 | 英文+中文注释 |
|--------|-------------|-------------|
| `'阴影'` | `'泛光 (Bloom)'` | `'FXAA 抗锯齿'` |
| `'暗角'` | `'景深 (DOF)'` | |
| `'色差'` | `'辉光 (Glow)'` | |

### 2.8 英文命名本身异常

| # | Key | 英文 | 问题 |
|---|-----|------|------|
| 35 | `motion.fingerPreset.peace` | `'Peace'` | V-sign 剪刀手，英文应是 `victory` 或 `vSign` |
| 36 | `settings.paths.audio` | `'Audio Music'` | "音频 音乐"叠词冗余 |
| 37 | `model-detail.fComment` | `'Readme（readme）'` | Readme 拼了两次 |
| 38 | `motion.retarget.customMap` | `'Custom Bone Map'` | 中文翻译"自定义骨骼映射"比英文更精确 |

---

## 三、ADR 交叉引用与 Code Health 评分

### 3.1 ADR 共犯/失职清单

| ADR | 状态 | 所涉问题 | 罪过等级 |
|-----|------|---------|---------|
| **ADR-029** | ✅ 已完成 | 问题 6：`env-gravity.ts` 重力+碰撞混居 | 🟡 **纵容** — 发现"物理放在动作菜单概念错误"却只改了 UI 没改代码结构 |
| **ADR-035** | ✅ 已完成 | 问题 9：`vsync` 假名 | 🟠 **自相矛盾** — 打勾"垂直同步 ✅"注脚却说"浏览器 RAF 天然同步" |
| **ADR-120** | ✅ 已完成 | 问题 10-12：碰撞字段不参与 dispatch | 🟠 **知情不报** — 行 39 明确列出"排除字段"但没追 schema 分组缺失 |
| **ADR-128** | ✅ 已完成 | `debugMirror` 命名滞后 | 🟢 **马后炮** — 功能升级几天后才写 ADR 改名 |
| **ADR-132** | ✅ 已完成 | 问题 5：`globalBrightness` 命名 vs dispatch | 🟢 **被动** — 创建了概念但没推改名 |
| **ADR-137** | ✅ 已完成 | 问题 10-15：碰撞/timeschema 无 group | 🔴 **失职** — 创建了 schema+dispatch 系统但亲手排除碰撞字段 |
| **ADR-146** | ✅ 已完成 | 问题 10-14：确认 handler 缺失但不修 | 🔴 **知情不报** — 行 466 白纸黑字"碰撞字段无 dispatchEnvChange handler 响应" |
| **ADR-172** | ✅ 已完成 | 问题 7：`env-wetness.ts` 命名错位 | 🟡 **文过饰非** — 承认只是 roughness 修改，以"测试导入链"为由取名 `wetness` |
| **ADR-195** | ✅ 已完成 | 下载文件夹命名全线误导 | 🟢 **自我批判** — 亲手揭发自己（ADR-181）的命名错误 |
| **ADR-209** | 📝 规划 | 问题 2：`sunAngle`三位一体 | 🟢 **诚实** — 写明"只有太阳一个天体"但未追溯字段命名 |
| **ADR-210** | ✅ 已完成 | 问题 4：`iblIntensity`/`globalBrightness` 改名 | 🟢 **迟到的正义** — 今天才改，问题从项目第一天就存在 |

### 3.2 按模块的健康评分

| 模块 | 发现的命名/翻译问题数 | 关联 ADR 失职数 | 健康评分 |
|------|---------------------|----------------|---------|
| `env-state-schema.ts` (group 系统) | 6（字段无 group） | 3（ADR-137/120/146） | 🔴 **2/10** — 系统级 bug 被三份 ADR 确认且不修 |
| `env-gravity.ts` | 2（命名+职责混杂） | 1（ADR-029） | 🟠 **4/10** — 功能对但组织错 |
| `env-wetness.ts` | 1（命名） | 1（ADR-172） | 🟡 **6/10** — 小误导 |
| `env-noise.ts` | 1（分类错误） | 0（无 ADR 提及） | 🟡 **5/10** — 孤儿文件 |
| `lighting.ts` 光照命名系 | 5（skyColor/sunAngle） | 2（ADR-209/210） | 🟠 **4/10** — 影响面大 |
| `locales/zh-CN.ts` 翻译 | 7（漏译+混杂） | 0 | 🟡 **6/10** — 不影响功能 |
| `settings.perf.vsync` | 1（假名） | 1（ADR-035） | 🟠 **3/10** — 显著误导 |

---

## 四、分级治理建议

按优先级从高到低，分三级实施：

### P0 — 功能性 Bug（写状态不生效）

| 问题 | 修复方案 | 工作量 | 风险 |
|------|---------|--------|------|
| 10-12：碰撞字段无 `group` | `env-state-schema.ts` 中给 `collisionEnabled/bodyCollisionEnabled/groundCollisionEnabled` 加 `group: 'collision'` + `env-impl.ts` 注册 `'collision'` dispatch handler 调用 `applyGroundCollision` | 小 | 低（纯加，不改既有路径） |
| 13-14：timeOfDay字段无 `group` | 加 `group: 'sky'`（因 `timeOfDayTick` 间接改 `sunAngle`），或新增 `'time'` group | 小 | 低 |
| 10-14 统一验证 | 新增契约测试：`setEnvState({ collisionEnabled: false })` 后断言碰撞实际关闭 | 中 | 无 |

### P1 — 高误导性命名

| 问题 | 修复方案 | 工作量 | 风险 |
|------|---------|--------|------|
| 27：`vsync` 假名 | Key 名改为 `frameCapEnabled` / `renderFrameCap`，UI 文案已为"帧率限制器"，同步迁移 | 中 | 低（需 `_migrators` 兼容 + Go UnmarshalJSON 兜底；参照 ADR-210 范式） |
| 6：`env-gravity.ts` 拆分 | 新建 `env-collision.ts`，将碰撞 setter/getter 从 `env-gravity.ts` 迁出；`env-gravity.ts` 只保留重力 | 中 | 低（纯搬函数） |
| 8：`env-noise.ts` 归位 | 搬到 `@/core/math/hash-noise.ts`；`env-noise.ts` 改为 re-export barrel（过渡期） | 小 | 低（命名空间引用需 grep 全量替换） |

### P2 — 命名边界澄清（不改名，加注释/文档）

| 问题 | 修复方案 |
|------|---------|
| 1-3：`skyColor*/sunAngle` 影响全场景光照 | 在 `env-state-schema.ts` 对应字段定义上加注释：`// ⚠ 同时通过 deriveLighting() 控制 direction light intensity/color/hemi` |
| 5：`globalBrightness` 在 `sky` 组 | 在字段定义加注释：`// 被归入 sky dispatch 组；修改 skyColor 时会触发重烘焙` |
| 7：`env-wetness.ts` | 文件头加注释：`// 材质湿润视觉特效，非物理湿度` |
| 35：`motion.fingerPreset.peace` | 加注释：`// V-sign (peace sign)` |
| 36-37：`Audio Music` / `Readme（readme）` | 英文 key 值修正为 `'Music'` / `'Readme'` |

### P3 — 翻译统一

| 问题 | 修复方案 | 工作量 |
|------|---------|--------|
| 16-18：全英文漏译 | 补译：`Environment→环境`、`MD Dress→MD 服装`、`Setting→配置` | 极小 |
| 19-21：中英混杂 | 统一为纯中文：`'音乐'`、`'道具'`、`'场景'` | 极小 |
| 28-34：风格不统一 | 统一策略：全部加 `(英)` 注释，或全部纯中文；建议全加英文注释以保持术语可检索性 | 小 |
| 26：同一英文两套中文 | `pitch/yaw/roll` 按上下文统一译法：手部"屈腕/摆腕/转腕"，脚部"背屈/内旋/侧翻"合理，保留 | 无 |

### P4 — 系统级改进（跨 ADR）

| 建议 | 说明 |
|------|------|
| **Schema group 完整性检查 CI** | 新增 lint 规则：`env-state-schema.ts` 中除 `groundPreset/timeOfDay*` 等已声明豁免字段外，所有字段必须有 `group`；无 `group` 的字段 `getEnvKeys()` 不收录，形成静默不派发 bug |
| **ADR 审计项"命名名实相符"** | 所有新字段/文件在 ADR 中强制审查：命名是否窄于实际功能？是否与已有字段近义混淆？ |
| **中文翻译包 CI 检查** | 检测 `zh-CN.ts` 中值包含纯英文片段（无中文字符）的条目，自动报告漏译 |

---

## 五、实施路线

| 阶段 | 内容 | 预计 PR 数 | 依赖 |
|------|------|-----------|------|
| **Phase 0** — P0 bugfix（碰撞+timeOfDay schema group） | 修改 `env-state-schema.ts` + `env-impl.ts` 加 handler + 写契约测试 | 1 | 无 |
| **Phase 1** — P1 高误导命名（vsync 假名 + gravity 拆分 + noise 归位） | 参照 ADR-210 `_migrators` 范式 + Go UnmarshalJSON 兜底 | 2-3 | Phase 0 先落地确保 schema group 完整 |
| **Phase 2** — P2 注释澄清 + P3 翻译补全 | 纯文档/文案改动，无逻辑风险 | 1 | 无 |
| **Phase 3** — P4 CI 工具链（group 完整性检查 + 漏译检测） | 新增 lint rules + CI step | 1 | 无 |

**总工作量预估**：4-7 个 PR，纯代码改动约 200-400 行（含迁移器 + 测试），文档/注释/翻译约 100 行。
