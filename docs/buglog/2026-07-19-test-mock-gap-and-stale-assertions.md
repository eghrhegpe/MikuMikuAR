# 测试修复：env-context mock 缺失 + 测试断言过时

**日期**: 2026-07-19
**关联**: ADR-137, env-water, env-particles, scene-stage, model-detail-ui

---

## 1. env-context `getScene` mock 缺口

### 根因

`env-water.ts` 和 `env-particles.ts` 通过 `env-context` 模块获取 `getScene()`：

```typescript
// env-water.ts
import { _envSys, getScene } from './env-context';
```

但测试文件只 mock 了 `env-impl` 的 `getScene`：

```typescript
vi.mock('../../scene/env/env-impl', () => ({
    getScene: () => (globalThis as any).__waterTestScene,
    // ...
}));
```

`env-impl` 虽然 re-exports `getScene` 从 `env-context`，但 `vi.mock` 拦截的是模块级导出。`env-water.ts` 直接 import 了 `env-context` 的 `getScene`，而非 `env-impl` 的 re-export，所以 mock 从未生效。

### 双重问题

1. `env-context.getScene()` 未被 mock → 调用 `initEnvImpl()` 之前调用 `getScene()` 抛 `[env-context] Scene not initialized`
2. `_envSys` 对象不共享：`env-impl` mock 创建了独立的 `_envSys`，但 `env-water.ts` 使用 `env-context` 的 `_envSys`，两者不同对象，测试的 `_envSys.water.mesh = null` 影响不到实际代码

### 修复

两个 mock 都通过 `globalThis` 共享 `_envSys` 和 `getScene`：

```typescript
vi.mock('../../scene/env/env-context', () => {
    if (!(globalThis as any).__waterTestEnvSys) {
        (globalThis as any).__waterTestEnvSys = { water: { mesh: null, material: null } };
    }
    return {
        _envSys: (globalThis as any).__waterTestEnvSys,
        getScene: () => (globalThis as any).__waterTestScene,
    };
});
```

### 波及文件

- `src/__tests__/scene/env-water.test.ts`
- `src/__tests__/scene/env-particles.test.ts`
- `src/__tests__/scene/water-preset-repro.test.ts`

### 教训

当测试目标模块 import 的是 A 模块的导出，而 A 又 re-exports 自 B 时，mock 必须拦截 A（直接消费者），不能只 mock B（间接来源）。`vi.mock` 按模块路径匹配，不关心 re-export 链。

---

## 2. scene-stage 测试测错组件

### 根因

`scene-stage.test.ts` 的 7 个测试用例测试 `buildStageLevel()`（舞台加载/道具管理），但断言地面/水面的开关行（`.collapsible-header` + `.collapsible-label` 内容匹配"地面"/"水面"）。这些开关行由场景根菜单（`scene-menu.ts` 的 `buildSceneRootItems()`）渲染，不在舞台层。

该测试可能是菜单重构前写的，菜单结构改变后未同步更新。

### 修复

重写为测试舞台层的实际内容：加载舞台按钮、加载道具按钮、空状态占位。移除 `findToggleRow` 辅助函数（已无消费方）。

---

## 3. `foamTransitionRange` 字段契约悬空

### 根因

`app.contract.test.ts` 的 EnvState 形状测试期望 `foamTransitionRange: expect.any(Number)`，但该字段：
- 不存在于 TS `EnvState` 接口（`types.ts`）
- 不存在于 Go `EnvState` 结构体（`app.go`）
- 不存在于 `createMockEnvState` 工厂输出

是 ADR-047 时代的遗留字段，已被移除，但契约测试未同步更新。

### 修复

从 `app.contract.test.ts` 的 expected 列表中移除 `foamTransitionRange`。

---

## 4. model-detail-ui 过时 collapsible-wrapper 断言

### 根因

`model-detail-ui.test.ts` 断言 `container.querySelectorAll('.collapsible-wrapper').length > 0`，但 `buildTransformCard` 重构后已不再使用 `.collapsible-wrapper` 类（多年前的折叠组 bug 修复，现在 DOM 结构已变）。

### 修复

移除该断言，保留 `.slide-item` 和 `.cs-row` 计数检查。

---

## 关联

- ADR-137: EnvState 单一源 Schema（测试基础设施修复为其前置条件）
- ADR-049: buildTransformCard innerHTML 清空误伤折叠组（原始 bug 已修复，断言未同步）