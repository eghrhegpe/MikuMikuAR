# ADR-142: withLoadingStatus 加载状态机统一

- **状态**: 立项
- **日期**: 2026-07-19
- **相关**: ADR-096（通用 Helper 收敛）、ADR-105（AbortSignal 传递规范）

## 背景与问题

`setStatus→await→setStatus` 加载状态机样板在代码库中重复 200+ 次，集中在：

| 文件 | setStatus 调用数 | 典型模式 |
|------|-----------------|----------|
| `menus/library-actions.ts` | 29 | 解压→加载模型→加载 VMD |
| `menus/scene-menu.ts` | 17 | 场景加载/保存 |
| `menus/motion-popup.ts` | 23 | 动作加载 |
| `menus/settings-paths.ts` | 11 | 路径设置 |
| `menus/settings-software.ts` | 11 | 软件管理 |

当前已有设施：
- `tryCatchStatus(fn, context)` — try/catch + 错误时 setStatus（44 处调用）
- `LoadingGuard` — per-instance 重入守卫
- `formatError(err)` — 错误格式化

**缺失**：成功时的状态更新需要调用方手写 `setStatus(successKey, true)`，导致 loading→success 两行样板在每个调用点重复。

## 决策

基于 `tryCatchStatus` 扩展一个 `withLoadingStatus` 包装器，只增加"成功时 setStatus"能力：

```typescript
async function withLoadingStatus<T>(
    loadingKey: string,
    successKey: string,
    fn: () => T | Promise<T>
): Promise<T | undefined>
```

**不在范围内**：
- 不集成 LoadingGuard — 调用方自行决定是否需要重入守卫
- 不传 AbortSignal — fn 由调用方闭包捕获信号
- 不统一所有 setStatus — 只针对 loading→async→success/error 三态模式

## 方案设计

### 1. withLoadingStatus 实现

```typescript
// core/utils.ts
export async function withLoadingStatus<T>(
    loadingKey: string,
    successKey: string,
    fn: () => T | Promise<T>
): Promise<T | undefined> {
    setStatus(t(loadingKey), true);
    try {
        const result = await fn();
        setStatus(t(successKey), true);
        return result;
    } catch (err) {
        const msg = translateGoError(err);
        if (/cancelled by user/i.test(msg)) return undefined;
        setStatus(`${t(loadingKey)}: ${msg}`, false);
        logWarn(loadingKey, '', err);
        return undefined;
    }
}
```

### 2. 迁移策略

**只迁移符合以下模式的调用点**：

```typescript
// 迁移前（3 行）
setStatus(t('library.extractingZip'), true);
const result = await extractZip(path);
setStatus(t('library.extracted'), true);

// 迁移后（1 行）
const result = await withLoadingStatus('library.extractingZip', 'library.extracted', () => extractZip(path));
```

**不迁移**：
- 单次 setStatus（如"设置已保存"）
- 需要 LoadingGuard 的调用点（保持现有 guard）
- 需要 AbortSignal 的调用点（保持现有闭包传递）

### 3. 分阶段实施

- **阶段 1（本 ADR）**: 新建 withLoadingStatus + 迁移 library-actions.ts（29 处，最大收益）
- **阶段 2**: 迁移 scene-menu.ts + motion-popup.ts
- **阶段 3**: 迁移 settings-paths.ts + settings-software.ts
- **阶段 4**: 全量测试

## 影响面

- **新增**: `core/utils.ts` +1 函数
- **修改**: 各菜单文件替换 setStatus 样板
- **行为**: 加载状态显示统一，错误处理不变

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| i18n key 变化 | 🟢 低 | loadingKey/successKey 复用现有 key |
| tryCatchStatus 重复逻辑 | 🟢 低 | withLoadingStatus 内联错误处理，不依赖 tryCatchStatus |

## 验收标准

- library-actions.ts setStatus 调用数从 29 降至 ≤10
- `npm run test` 全绿
- 状态栏行为无变化（loading/success/error 显示一致）
