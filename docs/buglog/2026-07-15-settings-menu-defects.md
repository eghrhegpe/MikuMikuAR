# 设置菜单两处功能缺陷（2026-07-15）

**发现日期**：2026-07-15  
**严重度**：🟠 P2（功能缺陷，影响用户体验）

---

## 问题描述

### Bug 1：启动软件丢失命令行参数

在「软件管理」详情页点击「启动」时，`managed` 模式添加的软件会丢失命令行参数（`args`），导致软件启动异常。

**复现路径**：
1. 进入「设置 → 软件管理」
2. 通过「添加自定义软件」添加一个需要参数的程序（如 Blender 指定脚本路径）
3. 进入该软件详情页，点击「启动」
4. 程序启动但未携带预期参数

### Bug 2：清理所有缓存按钮脱离卡片

在「关于」页面的「维护」卡片中，「清理所有缓存」按钮渲染到了卡片容器外部，导致布局异常。

**复现路径**：
1. 进入「设置 → 关于」
2. 滚动到「维护」卡片
3. 观察「清理所有缓存」按钮位置，发现它不在卡片内部

---

## 根因分析

### Bug 1：参数传递错误

**文件**：`frontend/src/menus/settings-software.ts:237`

```diff
- LaunchSoftware(entry.path, '')
+ LaunchSoftware(entry.path, entry.args || '')
```

同一功能在 3 处实现不一致：
- 列表项 trailing ▶：`LaunchSoftware(entry.path, entry.args || '')` ✅ 正确
- managed 详情页「启动」：`LaunchSoftware(entry.path, '')` ❌ **丢失 args**
- auto 详情页「启动」：`LaunchSoftware(entry.path, entry.args)` ✅ 正确

### Bug 2：容器变量误用

**文件**：`frontend/src/menus/settings-about.ts:383`

```diff
- slideRow(c, 'lucide:trash', ...)
+ slideRow(inner, 'lucide:trash', ...)
```

`cardContainer` 回调传入了 `inner`（卡片内容器），但「清理所有缓存」按钮错误地使用了外层的 `c`（卡片外容器），导致按钮被 append 到卡片外部。

---

## 修复方案

### Bug 1 修复

**文件**：`frontend/src/menus/settings-software.ts:237`

```diff
- LaunchSoftware(entry.path, '')
+ LaunchSoftware(entry.path, entry.args || '')
```

### Bug 2 修复

**文件**：`frontend/src/menus/settings-about.ts:383`

```diff
- slideRow(c, 'lucide:trash', ...)
+ slideRow(inner, 'lucide:trash', ...)
```

---

## 修复效果

| Bug | 修复后效果 |
|-----|-----------|
| Bug 1 | managed 模式软件启动时正确传递命令行参数，与列表页 / auto 详情页行为一致 |
| Bug 2 | 「清理所有缓存」按钮正确渲染在「维护」卡片内部，布局正常 |

---

## 关联改进（同期完成）

| 改进项 | 文件 | 说明 |
|--------|------|------|
| 路径截断统一 | `settings-shared.ts` | 抽取 `truncatePath(p, max=20)`，替换 3 处重复逻辑 |
| 快捷键动态化 | `settings-about.ts` | 从 `getAllShortcuts()` 动态读取，消除硬编码漂移（删除了不存在的 `Ctrl+5`） |
| 格式化函数迁移 | `shortcut-registry.ts` | `formatKeyBinding` 从 settings-shortcuts.ts 移入注册表，供多处复用 |
