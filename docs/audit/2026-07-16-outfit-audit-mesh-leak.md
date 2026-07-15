# 第⑤轮审核 — outfit 模块修复记录

**日期**: 2026-07-16
**发现方式**: 代码审核（第⑤轮）

---

## 修复 1: loadOverlay 骨骼重定向失败时已加载 mesh 泄漏（🔴 P1）

**文件**: `frontend/src/outfit/outfit-overlay.ts:228-258`

**问题**: `loadOverlay` 中 `ImportMeshAsync` 将 FBX mesh 加载到 scene 后，若 `retargetSkeleton` 返回 false，函数 `throw` 进入 catch 块。但 `meshes` 声明在 `try` 块内（`const meshes = ...`），catch 块无法访问，已加载的 mesh 残留在 scene 中永不释放。

**修复**:
1. `meshes` 声明提到 `try` 块外（`let meshes: Mesh[] = []`），使 catch 可访问
2. 空 mesh 路径（`meshes.length === 0`）：dispose `result.meshes` 中所有资源
3. 重定向失败路径（`!skeletonOk`）：dispose 后 throw
4. catch 块：遍历 `meshes` 逐个 dispose，兜底清理

**教训**: `try` 块内声明的资源变量在 catch 中不可见，是资源泄漏的经典模式。凡异步加载 → 失败 → catch 的路径，资源变量应提至 `try` 外。