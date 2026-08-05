# ADR-245: Babylon 9.x 插件访问规范 —— 禁止桥接私有数组，统一走公开只读属性

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；SSS 系两处落地修复：`material-sss.ts` / `sss-pbr-material.ts` 均从 `.plugins` 桥接改为 `subSurface` 公开属性）
> **编号**: 245
>
> **关联**: [ADR-189](adr-189-ktx2-texture-compression.md)（babylon-mmd fork 版本升级）、[ADR-188](adr-188-pbr-material-builder.md)（PBR 材质系统，subSurface 消费方）、[ADR-226](adr-226-ground-material-spec-single-source.md)（材质 spec 单源，同域约束）
>
> **来源**: 2026-08-05 第 11 轮代码审核（`docs/audit/`）P1：`material-sss.ts:142` 与 `sss-pbr-material.ts:44` 用 `(mat as unknown as { plugins?: unknown[] }).plugins` 桥接访问 PBRSubSurfaceConfiguration，但 Babylon 9.x 的 PBRMaterial **不存在 `plugins` 数组成员**（插件注册于私有 `pluginManager._plugins`），运行时恒得 undefined → SSS 功能静默失效，无任何报错。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据（两处同源 bug，均已修复）

`SssPBRMaterial`（`sss-pbr-material.ts`）与 `applySssToMaterial`（`material-sss.ts`）都需要拿到 `PBRMaterial` 内注册的 `PBRSubSurfaceConfiguration` 实例，两处都用了结构化桥接：

```ts
const plugins = (this as unknown as { plugins?: unknown[] }).plugins; // 恒 undefined
```

实测 Babylon 9.19（`@babylonjs/core`，`pbrMaterial.pure.js`）：

| 断言 | 证据 |
|------|------|
| `PBRMaterial` 无 `plugins` 数组成员 | `pbrBaseMaterial.pure.js` grep `.plugins` 零命中；`materialPluginManager.pure.d.ts:21` 插件存于私有 `_plugins` |
| 公开只读 `subSurface` 存在 | `pbrBaseMaterial.pure.d.ts:787` `readonly subSurface: PBRSubSurfaceConfiguration`；`pbrBaseMaterial.pure.js:680` 构造器 `this.subSurface = new PBRSubSurfaceConfiguration(this)` |
| 插件注册机制 | `MaterialPluginBase` 构造器将插件加入 `material.pluginManager._plugins`（私有） |

后果：`_subSurface` 恒为 `null`，`sssPower`/`sssColor` 等 setter 只改包装层私有字段，从不落到真实 `PBRSubSurfaceConfiguration` → **SSS 功能运行时静默失效**（无报错、无 warn，测试因 mock 遮蔽假绿）。

## 决策

1. **禁止**通过结构化桥接访问 Babylon 9.x 的私有插件数组（`plugins` / `pluginManager._plugins`），原因：私有成员在版本间可随意更名/移除，桥接在编译期不报错、运行时静默失效，是最难排查的一类缺陷。
2. **统一走公开只读属性**：访问 PBR 子表面配置一律用 `mat.subSurface`（`PBRBaseMaterial` 公开只读）。同类插件配置（sheen / clearCoat / anisotropy 等）同理走 `pbrBaseMaterial.pure.d.ts` 公开的只读属性。
3. **获取不到时的失败可见性**：`material-sss.ts` 保留 `!ss → logWarn` 兜底（已存在）；`sss-pbr-material.ts` 构造器直接赋值 `this._subSurface = this.subSurface`，若未来 API 再变，由测试断言（`instanceof` + subSurface 同步）抓回归，而非静默。
4. **升级大版本后的强制动作**：任何 `@babylonjs/core` / `babylon-mmd` 大版本升级，必须在升级提交中 grep 全仓 `as unknown as { plugins` 与 `pluginManager._plugins` 桥接模式，确认零残留或全部改走公开 API。

## 影响

- **修改文件**：`material-sss.ts`（`applySssToMaterial` 改用 `mat.subSurface`）、`sss-pbr-material.ts`（构造器改用 `this.subSurface`）。
- **测试**：`material-sss.state.test.ts` / `scene/sss-pbr-material.test.ts` 的 mock 从 `plugins = []` 改为挂 `subSurface` 真实 stub，并补传播断言（isTranslucencyEnabled / translucencyIntensity / tintColor 等落到 config）。
- **验证**：SSS 相关测试 27/27 通过；无行为回归。

## 回滚

如后续 Babylon 版本恢复 `plugins` 公开成员或引入新插件访问方式，按「更新本 ADR + 全仓 grep」流程处理，不直接改回桥接。

## 检查清单（供 code review / 子代理审核复用）

- [ ] 新代码中 `(x as unknown as { plugins` 桥接模式零残留（`npm run check:consumers` 辅助）
- [ ] 访问 PBR 插件配置一律走 `pbrBaseMaterial.pure.d.ts` 公开只读属性
- [ ] 插件获取失败路径有显式日志或测试断言，不静默
