# ADR-128: 镜面道具化重命名（debugMirror → mirror）

## 状态

> **状态**: ✅ 已完成（2026-07-20 代码核查确认：全部 debugMirror 重命名已迁移，仅 env-bridge.ts 迁移代码维持旧字段兼容引用；i18n 5 语种无残留）

**开始日期**: 2026-07-18

## 背景与问题

`mirror-debug.ts` 最初定位是「调试用镜面道具」——独立于 PlanarReflection 引擎，用 Babylon MirrorTexture 快速验证反射是否正常（地面/水面设置项太多，排查困难）。

但随着使用演进，镜面已**升级为场景道具**：用户可直接摆放、调整尺寸/分辨率，作为常态化反射道具使用，不再是临时调试工具。

**问题**：
1. 命名滞后：`debugMirror*` 前缀仍带「debug」语义，误导用户与开发者
2. i18n 文案滞后：5 语种显示「调试镜面」「Debug Mirror」「デバッグミラー」等，与实际定位不符
3. ADR-120 把 `debugMirrorEnabled` 归到 atmosphere 预设组，预设名也带 debug 语义

## 决策

### 重命名范围

| 层级 | 旧 | 新 | 备注 |
|------|----|----|------|
| EnvState 字段（TS） | `debugMirrorEnabled` | `mirrorEnabled` | Go 端无此字段（`app.go:415` EnvState 未定义），无需改 Go + 重生成 bindings |
| 实现层 API | `createDebugMirror` / `disposeDebugMirror` / `isDebugMirrorActive` / `toggleDebugMirror` / `refreshDebugMirrorRenderList` / `setDebugMirrorSize` / `setDebugMirrorPosition` / `setDebugMirrorRotationY` / `setDebugMirrorResolution` / `getDebugMirrorInfo` / `updateDebugMirrorClearColor` | `createMirror` / `disposeMirror` / `isMirrorActive` / `toggleMirror` / `refreshMirrorRenderList` / `setMirrorSize` / `setMirrorPosition` / `setMirrorRotationY` / `setMirrorResolution` / `getMirrorInfo` / `updateMirrorClearColor` | `mirror-debug.ts` 文件名保留（避免 git 历史断裂），仅改导出符号 |
| i18n key | `scene.debugMirror` / `scene.debugMirrorOn` / `scene.debugMirrorOff` / `scene.debugMirrorWidth` / `scene.debugMirrorHeight` / `scene.debugMirrorResolution` / `scene.debugMirrorHint` | `scene.mirror` / `scene.mirrorOn` / `scene.mirrorOff` / `scene.mirrorWidth` / `scene.mirrorHeight` / `scene.mirrorResolution` / `scene.mirrorHint` | 5 语种同步 |
| UI id | `stage:debugMirror` / `debugMirror` / `debugMirror:controls` | `stage:mirror` / `mirror` / `mirror:controls` | scene-stage-levels.ts |
| 内部 mesh/RT/mat 名 | `'debugMirror'` / `'debugMirrorRT'` / `'debugMirrorMat'` | `'mirror'` / `'mirrorRT'` / `'mirrorMat'` | mirror-debug.ts 内部 Babylon 资源名 |

### 序列化兼容

`migrateEnvState`（[env-bridge.ts:651](../../frontend/src/scene/env/env-bridge.ts#L651)）已有处理旧字段迁移的先例（groundMode → groundType+groundStyle）。新增一条迁移规则：

```typescript
if (typeof raw.debugMirrorEnabled === 'boolean') {
    out.mirrorEnabled = raw.debugMirrorEnabled;
    delete out.debugMirrorEnabled;
}
```

覆盖所有 hydrate 路径（main.ts / scene-serialize / 预设等），旧 scene preset / config.json 加载时自动迁移。

### ADR-120 同步

ADR-120 §字段分类表 atmosphere 组：`debugMirrorEnabled` → `mirrorEnabled`。

## 实施步骤

1. `mirror-debug.ts` — 导出符号 + 内部资源名重命名
2. `env-impl.ts` — re-export 同步
3. `env.ts` — barrel re-export 同步
4. `env-bridge.ts` — 调用点 + `migrateEnvState` 加迁移规则
5. `env-lighting.ts` — atmosphere 预设组字段名
6. `types.ts` — EnvState 字段
7. `state.ts` — 默认值字段
8. `scene-stage-levels.ts` — UI 调用 + i18n key + id
9. 5 语种 i18n key（zh-CN / zh-TW / ja / en / ko）
10. 测试 mock（`env-state.test.ts` + `binding-factories.ts`）
11. ADR-120 atmosphere 字段同步
12. 验证：`tsc --noEmit` + `go build` + `vitest`

## 验收标准

- [ ] `tsc --noEmit` 零新错误
- [ ] `go build ./...` 通过（Go 端无改动，仅验证未误伤）
- [ ] `vitest` 全绿（env-state / env-bridge 测试）
- [ ] 旧 scene preset 含 `debugMirrorEnabled` 字段时，加载后自动迁移为 `mirrorEnabled`
- [ ] UI 显示「镜面」而非「调试镜面」（5 语种同步）
- [ ] `grep debugMirror` 在 `frontend/src` 内零匹配（除 ADR 历史记录）

## 相关文档

- ADR-120 — 环境预设分类化（atmosphere 组字段同步）
- ADR-111 — 场景/环境菜单重划分（镜面在舞台根级作为场景道具）
