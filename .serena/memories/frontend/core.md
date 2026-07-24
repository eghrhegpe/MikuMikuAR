# 前端核心导航
- `frontend/src/core/`：状态、i18n、Wails bindings、资源/加载/安全调用等基础设施。
- `frontend/src/scene/`：Babylon 场景编排、环境、渲染、灯光、运动和模型管理。
- `frontend/src/__tests__/` 与 `frontend/src/core/__tests__/`：Vitest 测试。
- 修改场景资源或状态时，核对 observer、纹理、材质、RT、camera、scene 的创建/释放配对；性能优化需保留状态恢复和并发守卫。
- 详细前端构建和目录约定见 `frontend/AGENTS.md`；相关测试门槛见 `mem:task_completion`。