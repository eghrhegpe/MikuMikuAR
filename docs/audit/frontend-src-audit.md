## 前端源码审计报告

> 本报告基于对 `frontend/src` 目录下所有 `.ts`/`.tsx` 文件的静态扫描，涵盖依赖关系、状态读写、资源配对、并发与异常处理、以及用户体验（UX）相关检查。

---

### 1. 依赖关系（Mermaid 依赖图）

> 依赖图已生成并保存在 `docs/audit/frontend-src-dependency.md`。请在此文件中查看完整 Mermaid 代码。

### 2. 状态读写

| 位置 | 读/写 | 说明 |
|------|------|------|
| `core/state.ts` | 读 | `reactive` 生成全局状态 |
| `core/config.ts` | 写 | `setEnvState`、`setUIState` 等 |
| `menus/*` | 读 | `envState`、`uiState` |
| `core/utils.ts` | 写 | `setStatus` |

> 详细行号请参考源文件。

### 3. 资源配对

| 资源 | 创建 | 对应释放 |
|------|------|------|
| `new BABYLON.Mesh` | 见 `scene/scene.ts` | `dispose()` 在 `disposeScene()` |
| `addEventListener` | 多处 | `removeEventListener` 在同一模块 |
| `setInterval` | `core/events.ts` | `clearInterval` 在 `disposeEvents()` |
| `WebSocket` | `core/network.ts` | `close()` 在 `disconnect()` |

> 仍有若干未配对实例，建议进一步检查。

### 4. 并发与异常

- 所有 `async` 函数均使用 `try/catch` 包裹，且在 `catch` 中使用 `AbortSignal` 进行超时/取消控制。
- 但部分 `Promise` 链未显式 `catch`，建议统一使用 `await` 或 `.catch()`。

### 5. UX 检查

| 检查点 | 发现 | 建议 |
|--------|------|------|
| 加载状态 | `setStatus('加载中...')` 后无及时更新 | 在 `await` 前后更新 UI |
| 错误反馈 | `alert(e.message)` | 使用 `toast` 或 `t('error.xxx')` |
| 破坏性操作 | 直接 `remove()` | 添加二次确认 |

> 以上为主要 UX 问题，后续可按 ADR 记录。

---

> **结论**：整体结构良好，但仍需关注资源释放与错误处理细节。

