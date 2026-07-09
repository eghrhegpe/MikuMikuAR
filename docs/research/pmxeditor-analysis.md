# PmxEditor 分析记录

> 来源: `C:\Users\zhujieling11\Downloads\Compressed\MikuMikuDance_931_CHS\PmxEditor_0222 汉化By Emil`
> 版本: 0.222 (CHS 汉化版)
> 状态: **❌ 闭源软件，无公开源码**

---

## 开源状态

**PmxEditor 是闭源软件**，代码未公开。仅通过 .exe 分发，无法进行源码级分析。

---

## 技术栈推断

| 组件 | 技术 |
|------|------|
| 框架 | WPF (.NET Framework 4.0) |
| 图形 | SlimDX (DirectX 包装) |
| 物理 | Bullet Physics |
| Native 依赖 | Visual C++ 2010 Redistributable |

---

## 目录结构

```
PmxEditor/
├── PmxEditor.exe / PmxEditor 64位 CHS.exe  # 主程序
├── VMDView.exe                              # 动作预览工具
├── _data/                                   # 配置数据
│   ├── toon/                               # Toon 纹理 (toon01.bmp ~ toon10.bmp)
│   ├── UV表情作成用/                       # UV 表情模板
│   ├── スライダ変形/                       # 滑块变形预设
│   ├── 和英変換.txt                        # 日英人名/地名转换表
│   ├── IK制限角.txt                        # IK 限制角度参数
│   ├── Joint説明.txt                       # Joint 类型说明
│   ├── TexEdit.txt                         # 纹理编辑配置
│   ├── VMDリスト.txt                       # VMD 文件列表
│   ├── _toon.txt                           # Toon 配置
│   └── テンプレート/                        # 模板文件
├── _plugin/                                 # 插件系统
│   ├── CSScript/                           # C# 脚本 (.cs 文件可热加载)
│   ├── Launcher/                           # 启动器插件
│   ├── System/                             # 系统插件
│   └── User/                               # 用户插件（推荐放置位置）
├── Lib/                                     # 依赖库 (SlimDX, Bullet Physics 等)
└── Lib86/                                   # 32位依赖库
```

---

## 核心功能（从 readme.txt 解析）

### 三个编辑视图

| 视图 | 作用 |
|------|------|
| **PmxEdit** | 核心 PMX 编辑界面，标签式（顶点/材质/骨骼/Morph/刚体/Joint） |
| **PmxView** | 实时 3D 预览 + 轻量编辑，可独立于 PmxEdit 运行 |
| **TransformView** | 骨骼变换专用编辑，父子关系 + IK 测试 |

### PMX 编辑功能

**顶点**:
- 位置、法线、UV、追加 UV (1-4)
- 权重类型: BDEF1 / BDEF2 / BDEF4 / SDEF / QDEF
- SDEF 特殊参数: C, R0, R1 向量

**材质**:
- Diffuse / Specular / Ambient / Shininess
- 球谐纹理叠加模式: OFF / Multiply / Add / SubTex
- Toon 纹理（共享 toon 或自定义）
- 边缘绘制（轮廓线）

**骨骼**:
- 继承（父子）、IK
- 固定轴、本地轴
- 外部亲缘（对子骨骼的额外变换）
- 额外变形 (Additional Transform)

**Morph**:
- 顶点 Morph、UV Morph、追加 UV Morph (1-4)
- 骨骼 Morph、材质 Morph、Flip Morph、Group Morph
- TransformView 中可创建骨骼变换 Morph

**物理**:
- Rigid (刚体): 球/盒/胶囊形状，质量、摩擦、反弹
- Joint (关节): 6DOF / P2P / ConeTwist / Slider / Hinge
- SoftBody (软体)

### 插件系统

`_plugin/CSScript/` 目录支持 C# 脚本，修改后自动重新加载。这是 PmxEditor 唯一的"扩展"机制，无公开 SDK 或 API 文档。

---

## 功能对比

| 功能 | mmd_tools (开源) | PmxEditor (闭源) |
|------|-----------------|-----------------|
| PMX 编辑 | ✅ (Blender 内) | ✅ (独立工具) |
| 实时 3D 预览 | ✅ (Blender Viewport) | ✅ (PmxView) |
| Morph 编辑 | ✅ | ✅ |
| 骨骼 IK | ✅ | ✅ |
| 物理编辑 | ✅ (Blender Physics) | ✅ (Bullet) |
| 插件/脚本 | ❌ | ✅ (C# Script) |
| 材质球谐 | ✅ | ✅ |
| Toon 纹理 | ✅ | ✅ |

---

## 架构借鉴价值

**有限**。PmxEditor 无源码，仅能推断：

1. **WPF + SlimDX** — 成熟 Windows 桌面应用架构，MikuMikuAR 的 Wails/TypeScript 方案路线不同
2. **CSScript 热加载** — 运行时编译 C# 脚本的插件机制，有一定参考价值
3. **三视图分离** — PmxEdit / PmxView / TransformView 的职责划分清晰
4. **数据驱动 UI** — WPF 的数据绑定 (MVVM) 模式

但具体实现细节无从得知，无法用于代码级参考。

---

## 结论

对于 MikuMikuAR 项目，**mmd_tools 的开源代码比 PmxEditor 的闭源二进制更有参考价值**。建议：

- **首选参考**: mmd_tools v2.10.3（已分析，写入 `mmd_tools-architecture.md`）
- **PMX 格式**: 阅读 mmd_tools 的 `core/pmx/__init__.py` 数据结构定义 + `core/pmx/importer.py`
- **PmxEditor**: 仅作为功能对照表，了解 MMD 工具应支持的功能范围

如需深入了解 PmxEditor 实现，可尝试：
- `.NET IL 反编译` (ILSpy / dnSpy) — 但结果为反编译代码，非原始设计
- 运行时调试 — 附加调试器分析对象关系