# WASM 骨骼物理

> **背景**: WASM Bullet 物理暴露了最少参数，被 XPBD 布料挤到了后台——开关都藏在模型详情页的卡片里。
> **过程**: 在场景物理根页加独立 folder + 主从开关 UI，100% API 覆盖率，与 XPBD 共用重力控制器。

---

MmdWasmPhysics 坐在场景的角落里，已经很久没被认真对待了。

它被集成进来的那天，所有人都很兴奋——物理！骨骼刚体！裙摆自然飘动！这是 MikuMikuAR 从"看模型"迈向"玩模型"的第一步。

但后来 XPBD 布料来了。纯 TypeScript，轻量可定制，SDF 碰撞体，每帧调试可视化——全村的希望。

WASM 物理默默退到了后台。

它知道自己的局限。`MmdBulletPhysics` 只暴露了一个 `rigidBodyStates`——Int32Array，每个刚体一个 0 或 1。没有 stiffness slider，没有 damping knob，没有 friction dial。有的只是"开"和"关"，还有四个分类：裙子、胸部、头发、配件。

"你就不能多给我几个参数吗？"它曾经问过。

"不能，"babylon-mmd 说，"我的设计哲学是够用就好。你要调参，去写你自己的物理引擎。"

所以 WASM 物理的开关藏在模型详情弹窗的卡片里——用户要双击模型行，往下翻，找到"裙子物理"那一行，才能开关。而这个入口，藏在动作菜单里。

---

## 觉醒

"等等，"WASM 物理说，"你们都给布料加了重力 slider、时间缩放、碰撞主开关——我呢？"

外交官看了看模型详情弹窗里的物理卡片——四个 toggle：裙子物理、胸部物理、头发物理、配件物理。没有主开关，没有根页入口。

"你说得对。"

改动不大，但效果显著——在物理根页加了一个 "WASM 物理" folder，进入后可以看到：

```
模型物理 [toggle] — 主开关
├─ 裙子物理 [toggle]
├─ 胸部物理 [toggle]
├─ 头发物理 [toggle]
└─ 配件物理 [toggle]
```

主开关调用 `setModelPhysics(id, enabled)`，分类 toggle 调用 `setPhysicsCategory(id, cat, enabled)`。每一个 toggle 都实时读写 `modelManager` 的物理状态。

ModelManager 的物理分类 API 把刚体按命名前缀划分：`sk_`（裙子）、`chest_`（胸部）、`hair_`（头发）、`acc_`（配件）。每个分类的启用状态缓存在 `_physicsCatEnabled` 字典里，由 `setPhysicsCategory` 写入、`getPhysicsCategories` 读取。

"虽然我只有开关，"WASM 物理说，"但至少 UI 给全了。"

"100% 的 API 覆盖率，"外交官点头，"不多不少。"

---

## 共享的控制器

重力 slider 是另一重惊喜。

它一开始是给 XPBD 布料加的——`setClothGravity` 遍历所有 `clothInstances`，把强度写入每个求解器的 `_gravity` 向量。但在此之前项目已经有一个 `setGravityStrength` 函数，通过 `mmdRuntime.physics.setGravity` 控制 WASM Bullet 的重力 runtime。

外交官在实现时做了一个简单的选择：使用**同一个 slider**，同时调用两个函数。

```
用户拖动 slider → setClothGravity(value)   → XPBD 布料重力
                 → setGravityStrength(value) → WASM Bullet 重力
```

一个 slider，两个物理引擎同时响应。

"这还是第一次，"WASM 物理和 XPBD 布料异口同声，"我们被同一个控件控制。"

WASM 物理的参数仍然只有开关——它的 API 表面是 `MmdWasmPhysics` 的限制，不是代码的偷懒。但至少它不再藏在模型详情页的卡片里了。它在场景菜单的物理页面上，有自己的 folder、自己的 toggle、自己的位置。

排在布料前面——不是因为谁更强大，而是因为谁更基础。

> **覆盖的边界**：100% API 覆盖率意味着该暴露的都暴露了——不多不少。当引擎不给更多参数时，给全开关就是给全了。
