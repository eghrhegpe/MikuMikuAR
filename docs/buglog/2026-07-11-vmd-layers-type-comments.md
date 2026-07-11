# 第⑤轮审核 — VMD 加载 + 图层类型安全修复

**日期**: 2026-07-11
**发现方式**: 代码审核（第⑤轮）

---

## 修复 1: vmd-loader.ts L97 — VmdLoader dispose 双重 cast 注释

`VmdLoader` 类型声明未包含 `dispose` 方法，但运行时实现了该 API。添加注释说明业务理由：释放解析器内部 ArrayBuffer 引用，避免大 VMD 文件内存驻留。

## 修复 2: vmd-loader.ts L140 — currentAnimation 伪私有属性注释

`babylon-mmd` 类型声明未暴露 `currentAnimation` 属性（内部实现）。添加注释说明需要取出旧动画句柄显式 dispose 以释放 WASM AnimCurve 资源。

## 修复 3: vmd-layers.ts L588 — MmdCompositeAnimation 接口兼容性注释

`MmdCompositeAnimation` 运行时实现了 `IMmdBindableModelAnimation` 接口，但 `babylon-mmd` 类型声明未暴露此继承关系。添加注释说明双重 cast 的必要性。

## 修复 4: wasm-layers-blender.ts L106 — has() 守卫注释

`_blenderStates.get(modelId)!` 非空断言有同行 `.has()` 守卫，添加注释确认安全性。

## 修复 5: wasm-layers-blender.ts L259 — perception.ts 扩展注释

`bone as MmdRuntimeBoneExtended` 访问 perception.ts 扩展的 `worldMatrix` 属性，`babylon-mmd` 类型声明未包含此扩展。添加注释说明。
