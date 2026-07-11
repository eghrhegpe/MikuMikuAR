# 第⑦轮审核 — MmdRuntimeBoneExtended 接口去重

**日期**: 2026-07-11
**发现方式**: 代码审核（第⑦轮）

---

## 问题

`MmdRuntimeBoneExtended` 接口在 `perception.ts` 和 `bone-override.ts` 中完全重复定义：
```typescript
interface MmdRuntimeBoneExtended extends IMmdRuntimeBone {
    worldMatrix: Float32Array;
    updateWorldMatrix(updateAbsoluteTransform: boolean, updateLocalTransform: boolean): void;
}
```

两个文件各自维护一份相同的接口声明，违反 DRY 原则。`wasm-layers-blender.ts` 从 `perception.ts` 导入该类型。

## 修复

将 `MmdRuntimeBoneExtended` 提取到 `core/types.ts`（与 `MmdRuntimeType` 同级），三个消费方统一导入：

- `perception.ts` — import from `@/core/types`
- `bone-override.ts` — import from `@/core/types`
- `wasm-layers-blender.ts` — import from `@/core/types`（原从 `./perception` 导入，现已改为直接导入）

同时删除 `perception.ts` 中的冗余 `export type { MmdRuntimeBoneExtended }` 再导出。

## 附带修复

`bone-override.ts:230` — 为 `as unknown as { linkedBone? }` 双重 cast 添加注释说明业务理由（JS 模式伪私有属性访问）。
