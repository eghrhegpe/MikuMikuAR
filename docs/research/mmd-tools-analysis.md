# Blender MMD Tools 竞品分析

> **调研日期**: 2026-07-02  
> **调研目的**: 了解 MMD Tools 的材质分组、骨骼关联机制，为 MikuMikuAR 的材质管理系统提供参考  
> **参考版本**: MMD Tools 4.5.13 (Blender 4.2+)

---

## 一、核心发现摘要

| 维度 | MMD Tools 实现 | 对 MikuMikuAR 的启示 |
|------|---------------|---------------------|
| **材质-骨骼关联** | 无直接关联，通过顶点权重间接实现 | 需要实现基于权重的自动分组算法 |
| **材质命名** | 支持日文/英文双名，无罗马字标准 | 可扩展多语言材质名称支持 |
| **导入层级** | ROOT → ARMATURE + MESH(多) + 刚体/关节 | 参考其对象层级设计 |
| **材质操作** | 按材质分离、按骨骼分离、合并网格 | 可实现类似的材质拆分/合并 UI |

---

## 二、PMX 格式数据结构（MMD Tools 处理基础）

### 2.1 材质与骨骼的关系

**关键结论**: PMX 格式中，材质和骨骼是**完全独立的数据块**，无直接关联字段。

```
PMX 文件结构:
├── 顶点数据 (带骨骼权重)
├── 面数据 (按材质索引范围分组)
├── 纹理引用
├── 材质数据 ←── 独立
├── 骨骼数据 ←── 独立
├── 表情数据
├── 框架数据
├── 刚体数据
└── 关节数据
```

**间接关联路径**:
```
骨骼 → 顶点权重 → 顶点 → 面 → 材质
```

- 每个顶点可关联 1-4 个骨骼 (BDEF1/BDEF2/BDEF4/SDEF)
- 材质的 `绘制顶点数` 属性划分面索引范围
- 通过遍历顶点权重，可反推"哪些材质受哪些骨骼影响"

### 2.2 材质数据格式

```typescript
interface PMXMaterial {
  name_j: string;      // 日文名称
  name_e: string;      // 英文名称
  diffuse: [number, number, number, number];  // RGBA
  specular: [number, number, number];
  specular_power: number;
  ambient: [number, number, number];
  flags: number;       // 位标志
  edge_color: [number, number, number, number];
  edge_size: number;
  texture_index: number;
  sphere_index: number;
  sphere_mode: number;
  toon_sharing: number;
  toon_index: number;
  comment: string;
  vertex_count: number;  // 关键：该材质的顶点数
}
```

**重要**: `vertex_count` 是材质分组的核心依据。通过累加各材质的 `vertex_count`，可划分面索引范围。

---

## 三、MMD Tools 的材质分组机制

### 3.1 导入时的对象层级

MMD Tools 导入 PMX 后，在 Blender 中创建的对象层级：

```
[模型名] (Empty, mmd_type='ROOT')
├── [模型名] (Armature, mmd_type='ARMATURE')
│   └── 骨骼们 (PoseBone with mmd_bone properties)
├── [模型名].001 (Mesh, mmd_type='MESH')
│   ├── Material Slots: [材质1, 材质2, ...]
│   └── Vertex Groups: [骨骼1, 骨骼2, ...] (对应权重)
├── [模型名].002 (Mesh) - 如果有多个 Mesh
├── RigidGrp (Empty, mmd_type='RIGID_GRP_OBJ')
└── JointGrp (Empty, mmd_type='JOINT_GRP_OBJ')
```

**关键点**:
- 默认情况下，一个 PMX 导入为一个或多个 Mesh 对象
- 每个 Mesh 对象包含多个 Material Slots
- 顶点组 (Vertex Groups) 对应骨骼，存储权重数据

### 3.2 "按材质分离" 功能

**操作**: `Separator > By Material`
**效果**: 将每个材质拆分为独立的 Mesh 对象

```
分离前:
Mesh (合并)
├── Material Slot 1 (材质A)
├── Material Slot 2 (材质A)
└── Material Slot 3 (材质B)

分离后:
Mesh.001 (材质A)
└── Material Slot 1 (材质A)

Mesh.002 (材质A)
└── Material Slot 1 (材质A)

Mesh.003 (材质B)
└── Material Slot 1 (材质B)
```

**实现逻辑** (推测):
1. 遍历每个材质的面索引范围
2. 创建新 Mesh 对象
3. 复制对应面到新对象
4. 重新计算法线、UV 等

### 3.3 "按骨骼分离" 功能

**操作**: `Model > Separate by Bones`
**效果**: 根据选择的骨骼，将受其影响的顶点分离到新对象

**实现逻辑** (推测):
1. 用户选择骨骼 (如 "左腕")
2. 遍历所有顶点，检查其权重是否受该骨骼影响
3. 将受影响顶点及其面分离到新 Mesh
4. 新 Mesh 包含这些顶点关联的所有材质

**局限性**:
- 一个顶点可能受多个骨骼影响 (BDEF4)
- 分离阈值 (权重阈值) 需要用户指定
- 可能导致材质碎片化

---

## 四、材质命名模式分析

### 4.1 PMX 标准

PMX 格式支持双名系统：
- `name_j`: 日文名称 (Shift-JIS 或 UTF-8)
- `name_e`: 英文名称 (可选，PMX 2.0+)

**示例**:
```
name_j: "左腕"
name_e: "Arm_L"
```

### 4.2 实际模型中的命名模式

根据社区经验，材质命名常见模式：

| 模式 | 示例 | 说明 |
|------|------|------|
| **纯日文** | `左腕`, `スカート` | 早期模型 |
| **日文+英文** | `LeftArm (左腕)`, `Skirt (スカート)` | 常见 |
| **英文** | `Arm_L`, `Skirt` | 国际化模型 |
| **罗马字** | `HidariUde`, `Suka-to` | 少数模型，非标准 |
| **混合** | `Arm_L (左腕)`, `腕_左` | 个人习惯 |

**MMD Tools 处理**:
- 导入时保留 `name_j` 和 `name_e`
- Blender 材质名默认使用 `name_e` (如有)，否则 `name_j`
- 用户可随时在 Blender 中重命名

### 4.3 对 MikuMikuAR 的建议

1. **支持多语言材质名**:
   ```typescript
   interface MaterialInfo {
     name: string;        // 显示名称
     name_j?: string;     // 日文原名
     name_e?: string;     // 英文原名
     searchTags: string[]; // 搜索标签
   }
   ```

2. **智能分组**:
   - 优先按英文名分组 (如 `Arm_L`, `Arm_R` → "Arm" 组)
   - 备用日文名模式匹配 (如 `左腕`, `右腕` → "腕" 组)
   - 允许用户自定义分组规则

---

## 五、材质分组算法设计（参考 MMD Tools）

### 5.1 基于骨骼权重的分组

**目标**: 将材质按"主要影响的骨骼"分组

**算法**:
```typescript
function groupMaterialsByBone(pmx: PMXData): Map<string, string[]> {
  const boneMaterialMap = new Map<string, Set<string>>();
  
  // 1. 遍历所有顶点
  for (const vertex of pmx.vertices) {
    const boneIds = getBoneIds(vertex); // 根据 BDEF 类型提取骨骼 ID
    const weights = getWeights(vertex);
    
    // 2. 找到影响最大的骨骼
    const mainBoneId = boneIds[0]; // 简化：取第一个骨骼
    const mainWeight = weights[0];
    
    if (mainWeight > 0.5) { // 阈值
      // 3. 找到该顶点对应的材质
      const material = findMaterialByVertex(vertex, pmx);
      
      // 4. 记录到映射表
      if (!boneMaterialMap.has(mainBoneId)) {
        boneMaterialMap.set(mainBoneId, new Set());
      }
      boneMaterialMap.get(mainBoneId)!.add(material.name);
    }
  }
  
  // 5. 转换为分组结果
  return convertToGroups(boneMaterialMap, pmx.bones);
}
```

**输出示例**:
```json
{
  "Root": ["Body"],
  "Arm_L": ["Arm_L", "Sleeve_L"],
  "Arm_R": ["Arm_R", "Sleeve_R"],
  "Skirt": ["Skirt_1", "Skirt_2", "Skirt_3"]
}
```

### 5.2 基于名称模式的分组

**目标**: 按材质名称的关键词分组

**算法**:
```typescript
function groupMaterialsByName(materials: Material[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  
  for (const material of materials) {
    const groupKey = extractGroupKey(material.name);
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(material.name);
  }
  
  return groups;
}

function extractGroupKey(name: string): string {
  // 规则1: 提取基础名 (去掉 _L, _R, .001 等)
  let key = name
    .replace(/_[LR]$/, '')      // 去掉 _L, _R
    .replace(/\.\d+$/, '')       // 去掉 .001, .002
    .replace(/（.*）$/, '')     // 去掉中文括号注释
    .replace(/\(.*\)$/, '');     // 去掉英文括号注释
  
  // 规则2: 日文名转英文关键词
  const jpToEn: Record<string, string> = {
    '左腕': 'Arm_L',
    '右腕': 'Arm_R',
    'スカート': 'Skirt',
    // ...
  };
  
  return jpToEn[key] || key;
}
```

### 5.3 混合分组策略

**推荐**: 结合骨骼权重和名称模式

```typescript
async function autoGroupMaterials(
  pmx: PMXData,
  options: GroupOptions
): Promise<MaterialGroups> {
  // 1. 尝试基于骨骼权重分组
  const boneGroups = groupMaterialsByBone(pmx);
  
  // 2. 对未分组的材质，尝试基于名称分组
  const ungrouped = findUngrouped(materials, boneGroups);
  const nameGroups = groupMaterialsByName(ungrouped);
  
  // 3. 合并结果
  return mergeGroups(boneGroups, nameGroups);
}
```

---

## 六、MMD Tools 的其他有用功能

### 6.1 材质编辑

MMD Tools 提供材质编辑面板，支持：
- 修改漫反射、高光、环境光颜色
- 调整边缘线和边缘大小
- 更换纹理、球形贴图、Toon 贴图
- 修改渲染标志 (双面、阴影等)

**对 MikuMikuAR 的启示**:
- 实现类似的材质编辑 UI
- 参考 MMD Tools 的材质属性面板布局

### 6.2 刚体编辑

MMD Tools 支持可视化编辑刚体 (Rigid Body)：
- 显示/隐藏刚体
- 调整刚体形状、尺寸、位置
- 设置物理参数 (质量、弹力、摩擦)

**对 MikuMikuAR 的启示**:
- 如果实现物理模拟，可参考其刚体编辑 UI

### 6.3 动作编辑

MMD Tools 支持 VMD 动作编辑：
- 导入/导出 VMD
- 编辑关键帧
- 动作平滑、插值

**对 MikuMikuAR 的启示**:
- 如果实现动作编辑功能，可参考其关键帧编辑 UI

---

## 七、与 MikuMikuAR 的对比

| 功能 | MMD Tools (Blender) | MikuMikuAR (目标) |
|------|---------------------|-------------------|
| **材质分组** | 手动 (按材质/骨骼分离) | 自动 (基于算法) |
| **材质编辑** | 完整 (所有 PMX 属性) | 基础 (颜色、纹理) |
| **骨骼显示** | 完整骨架可视化 | 简化 (只显示关键骨骼) |
| **物理编辑** | 刚体/关节可视化编辑 | 无 (只读) |
| **动作编辑** | VMD 关键帧编辑 | 播放控制 (无编辑) |
| **目标用户** | 3D 艺术家、动画师 | MMD 模型查看者 |
| **使用场景** | 模型编辑、动画制作 | 快速查看、简单调整 |

**结论**: MikuMikuAR 不需要完全复制 MMD Tools 的功能，而应专注于：
1. **智能材质分组**: 自动按骨骼/名称分组，简化材质管理
2. **快速材质编辑**: 提供常用属性的快速调整 UI
3. **流畅的查看体验**: 优化渲染性能，支持大模型

---

## 八、实施建议

### 8.1 短期目标 (Phase 9.x)

1. **实现基础材质分组**:
   - 基于名称模式的分组 (规则可配置)
   - UI 展示分组列表，支持展开/折叠

2. **添加材质搜索**:
   - 支持日文/英文关键词搜索
   - 搜索结果高亮显示

### 8.2 中期目标 (Phase 10)

1. **实现骨骼权重分组**:
   - 解析 PMX 顶点权重数据
   - 计算材质-骨骼关联度
   - 自动生成分组建议

2. **允许用户调整分组**:
   - 拖拽材质到不同组
   - 创建自定义组
   - 保存分组配置

### 8.3 长期目标 (Phase 11+)

1. **智能分组学习**:
   - 记录用户的分组习惯
   - 对新模型应用相似的分组规则

2. **分组模板**:
   - 预设常见角色类型的分组模板 (如 "初音未来型", "通用人体型")
   - 用户可选择模板快速分组

---

## 九、参考资料

1. **PMX 文件格式规范**:
   - [PMX文件格式解析 - CSDN](https://blog.csdn.net/qq_36981993/article/details/126340316)
   - [PMX Format Specification (English)](https://cdn.discordapp.com/attachments/362924202905256007/450571867788984320/PMX_format_specification.txt)

2. **MMD Tools 源码**:
   - [GitHub - MMD-Blender/blender_mmd_tools](https://github.com/MMD-Blender/blender_mmd_tools)
   - 关键文件:
     - `io.py`: 导入/导出逻辑
     - `properties.py`: 属性定义
     - `operators.py`: 操作命令

3. **Blender API**:
   - [Blender Python API - Material Slots](https://docs.blender.org/api/current/bpy.types.MaterialSlot.html)
   - [Blender Python API - Vertex Groups](https://docs.blender.org/api/current/bpy.types.VertexGroup.html)

---

## 十、附录：MMD Tools 导入选项

MMD Tools 导入 PMX 时的选项：

```python
class ImportPMX:
    def __init__(self):
        self.filepath: str = ""
        self.scale: float = 0.08  # MMD 到 Blender 的单位缩放
        self.ignore_non_uv: bool = False
        self.ignore_transparency: bool = False
        self.use_mipmap: bool = True
        self.smooth_shading: bool = True
        self.edge_threshold: float = 0.01
        self.copy_textures: bool = False
        self.use_underscore: bool = False  # 将空格转为下划线
        self.use_separate_materials: bool = False  # 按材质分离 Mesh
```

**关键选项**:
- `use_separate_materials`: 导入时直接按材质分离 Mesh
- `scale`: MMD 单位 (0.08) 到 Blender 单位的缩放
- `use_underscore`: 材质名规范化选项

---

**文档状态**: 🟢 初稿完成  
**下一步**: 根据此文档实现 MikuMikuAR 的材质分组功能
