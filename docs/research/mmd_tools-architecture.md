# MMD Tools v2.10.3 架构分析 — 来自 Blender 插件的启发

> 源码: `C:\Users\zhujieling11\Downloads\Compressed\MikuMikuDance_931_CHS\mmd_tools-v2.10.3`
> 版本: 2.10.3 (UuuNyaa fork)
> 分析目的: 为 MikuMikuAR (TypeScript/Babylon.js) 寻找可复用的架构模式和实现思路

---

## 1. 架构总览

MMD Tools 是一个纯 Python Blender 插件，无 C 扩展，无 WASM 依赖，完全基于 Blender bpy API 构建。

```
mmd_tools/
├── __init__.py          # 插件入口，menu 注册
├── auto_load.py          # 核心：自动 import + 拓扑排序注册
├── bpyutils.py          # Blender API 工具封装（context manager 模式）
├── operators/           # 操作符（命令）
│   ├── fileio.py        # 导入/导出 PMX VMD VPD
│   ├── model.py         # 模型操作（构建rig、morph slider setup）
│   └── ...
├── panels/              # UI 面板
│   ├── tool.py          # 主工具面板（3D View 侧边栏）
│   ├── prop_object.py   # 属性面板（Object Properties）
│   └── ...
├── properties/          # Blender PropertyGroup 定义
│   ├── __init__.py     # 属性注册到 bpy.types.Object 等
│   ├── bone.py
│   └── material.py
├── core/                # 核心业务逻辑
│   ├── model.py         # Model 类（~900行）：物理rig构建、IK constraint
│   └── pmx/             # PMX 格式解析
│       ├── __init__.py  # 数据结构定义（~1600行）
│       ├── importer.py  # 导入管道（~1000行）
│       └── exporter.py  # 导出管道（~1300行）
└── utils.py             # 名字转换、日文→英文
```

**关键架构决策**: 所有 operators/panels/properties 都是独立的 Python 模块，通过 `auto_load.py` 自动发现并按拓扑排序注册到 Blender，无需手动维护注册顺序。

---

## 2. 最值得借鉴的模式

### 2.1 Auto-Load 拓扑排序注册 (`auto_load.py`)

这是 mmd_tools 最精巧的设计。整个注册系统：

```python
# 自动发现所有子模块
modules = get_all_submodules(Path(__file__).parent)

# 提取所有需要注册的类（Panel/Operator/PropertyGroup 等）
ordered_classes = get_ordered_classes_to_register(modules)

# 通过类型注解和 bl_parent_id 推断依赖关系，拓扑排序后依次注册
for cls in ordered_classes:
    bpy.utils.register_class(cls)
```

**依赖推断逻辑**:
- **类型注解**: `PointerProperty(type=SomeClass)` → 推断 SomeClass 先注册
- **Panel 继承**: `bl_parent_id = "parent_panel_id"` → 推断 parent_panel 先注册

**对 MikuMikuAR 的启发**: 这套模式可以用作前端的**命令/组件自动注册系统**。不在 `main.ts` 手动 import 几百个命令，而是：

```typescript
// 概念：自动发现 + 依赖排序注册
const modules = discoverCommands('./commands/**/*');
const ordered = topologicalSort(detectDeps(modules));
for (const cmd of ordered) registerCommand(cmd);
```

### 2.2 双命名系统 (name_j / name_e)

MMD 是日本软件，所有 MMD 相关数据都有日文名和英文名：

```python
# properties/bone.py
class MMDBone(PropertyGroup):
    name_j = StringProperty(name='Name', description='Japanese Name')
    name_e = StringProperty(name='Name(Eng)', description='English Name')

# properties/material.py
class MMDMaterial(PropertyGroup):
    name_j = StringProperty(name='Name', description='Japanese Name')
    name_e = StringProperty(name='Name(Eng)', description='English Name')
```

**对 MikuMikuAR 的启发**: 对于一个可能处理日本 MMD 模型的国际应用，需要类似的 dual-name 数据结构：

```typescript
interface MMDNamed {
  name_j: string;      // 日文名（显示/匹配用）
  name_e?: string;     // 英文名（可选）
  name_search?: string[]; // 搜索标签
}
```

### 2.3 属性 ID 系统（morph 引用）

MMD 的 bone 和 morph 之间通过整数 ID 相互引用，而不是字符串名字：

```python
# properties/bone.py
class MMDBone(PropertyGroup):
    bone_id = IntProperty(name='Bone ID', description='Unique ID for morph references')

# Morph 引用 bone_id 而非 bone name
class MorphVertex:
    bone_id: int  # 引用 MMDBone.bone_id
```

**对 MikuMikuAR 的启发**: 用整数 ID 而非字符串名字做数据关联，避免名字冲突和重命名问题。

---

## 3. PMX 导入管道（最完整的参考实现）

### 3.1 完整导入流程

`core/pmx/importer.py` 的 `PMXImporter` 是最值得研究的代码（~1000行）。完整流程：

```
ImportPmx.execute()
  └─> PMXImporter.execute()
       ├─> __createObjects()        创建 ROOT 空对象 + ARMATURE
       ├─> __importVertices()      顶点 + 顶点组（骨权重）
       ├─> __importMaterials()     创建材质 + 纹理槽
       ├─> __importFaces()         面 + 材质索引分配
       ├─> __importBones()          EditBone + PoseBone + IK 约束
       ├─> __importRigids()         刚体
       ├─> __importJoints()         关节
       ├─> __importMorphs()          Shape Key（顶点morph）+ 其他morph类型
       └─> __importDisplayFrames()  显示帧（UI 组织用）
```

### 3.2 顶点组 = 骨权重映射

这是 MMD 的核心数据映射，直接决定模型变形质量：

```python
# core/pmx/importer.py::__importVertices()
# PMX 顶点权重格式 → Blender 顶点组

if isinstance(pv_weights, pmx.BoneWeightSDEF):
    # SDEF 转为 BDEF2（Blender 不支持 SDEF）
    vertex_group_table[pv_bones[0]].add(weight=pv_weights.weight, type='ADD')
    vertex_group_table[pv_bones[1]].add(weight=1.0-pv_weights.weight, type='ADD')

elif len(pv_bones) == 1:  # BDEF1: 单骨 100% 权重
    vertex_group_table[bone_index].add(weight=1.0, type='ADD')

elif len(pv_bones) == 2:  # BDEF2: 两骨权重
    vertex_group_table[pv_bones[0]].add(weight=pv_weights[0], type='ADD')
    vertex_group_table[pv_bones[1]].add(weight=1.0-pv_weights[0], type='ADD')

elif len(pv_bones) == 4:  # BDEF4: 四骨权重
    for bone, weight in zip(pv_bones, pv_weights):
        vertex_group_table[bone].add(weight=weight, type='ADD')
```

**MMD 权重类型**:
| 类型 | 说明 | Blender 兼容 |
|------|------|------------|
| BDEF1 | 单一骨骼 100% | ✅ 直接支持 |
| BDEF2 | 两骨骼按权重分配 | ✅ 直接支持 |
| BDEF4 | 四骨骼按权重分配 | ✅ 直接支持 |
| SDEF | 特殊变形（带 C/R0/R1 向量） | ⚠️ 转为 BDEF2 |

**对 MikuMikuAR 的启发**: Babylon.js 的 `mesh.setVerticesData` + `mesh.applySkeleton` 可以直接映射这套逻辑。BDEF 权重对应 SkeletonMeshChunk 的 `matricesIndices` + `matricesWeights`。

### 3.3 材质-面索引关系

MMD 的材质不是 per-face 的，而是定义每个材质的**顶点数量**，面按索引顺序归属材质：

```python
# 伪代码描述 mmd_tools 的逻辑
for material in pmx_model.materials:
    vertex_count = material.vertex_count  # 这个材质使用的顶点数
    for _ in range(vertex_count):
        face = get_next_face()
        face.material_index = material.index
```

**对 MikuMikuAR 的启发**: Babylon.js 的 `mesh.getIndices()` 返回面索引数组，需要类似地按材质分组：

```typescript
// 按 material_index 分组 faces
const facesByMaterial: Map<number, number[]> = new Map();
for (let i = 0; i < indices.length / 3; i++) {
    const matIdx = indices[i * 3 + 2]; // MMD 的 material_index 在第三个分量
    if (!facesByMaterial.has(matIdx)) facesByMaterial.set(matIdx, []);
    facesByMaterial.get(matIdx)!.push(i);
}
```

---

## 4. 对象层级结构

mmd_tools 的场景组织非常清晰：

```
ROOT (Empty, mmd_type='ROOT')
  └─> ARMATURE (Armature)
       └─> BONES (PoseBone with mmd_bone properties)
  └─> MESHES (Mesh, multiple)
  └─> RigidBody_Group (Empty, physics)
       └─> rigid_body_N (Mesh, collision shape)
  └─> Joint_Group (Empty, constraints)
       └─> joint_N (Empty, constraint)
```

**物理对象层级**: 刚体和关节是**独立对象**，不合并到主模型层级，通过 Blender rigid body constraint 连接。

**对 MikuMikuAR 的启发**: 这个层级结构可以直接映射到 Babylon.js 的场景图：

```typescript
interface MMDSceneHierarchy {
    root: TransformNode;     // ROOT
    armature: Skeleton;       // ARMATURE
    meshes: AbstractMesh[];  // MESHES
    rigidBodies: Mesh[];     // 物理刚体（可见或不可见）
    joints: any[];           // 物理约束
}
```

---

## 5. IK 约束系统（自定义追踪）

MMD 的 IK 和 Blender 的 IK 机制不同。mmd_tools 实现了一套**自定义 IK 追踪系统**：

```python
# core/pmx/importer.py::__applyIk()
# 1. 创建空的 IK target tracker
# 2. DAMPED_TRACK constraint 指向 IK 控制骨骼
# 3. IK constraint on 父骨骼 + chain_count
# 4. LIMIT_ROTATION constraint 控制角度限制
# 5. mmd_bone.mmd_ik_toggle 控制开关
```

关键约束类型：
- `mmd_ik_target_override`: 自定义追踪约束
- `LIMIT_ROTATION`: IK 角度限制
- `DAMPED_TRACK`: 方向追踪

**对 MikuMikuAR 的启发**: Babylon.js 的 IK 实现需要类似的自定义约束链。可以参考：
- `BABYLON.IKConstraint` (Babylon.js 提供的 IK)
- 或自己实现基于 `BABYLON.TransformNode` 的自定义 IK 追踪

---

## 6. Morph 系统

MMD 的 morph（变形）有多种类型，mmd_tools 通过不同的 Blender 机制实现：

| Morph 类型 | Blender 实现 | mmd_tools 处理 |
|-----------|-------------|--------------|
| Vertex Morph | Shape Keys | 直接映射到 shape key offsets |
| Bone Morph | PoseBone 偏移 | 创建 delta pose |
| Material Morph | 材质属性覆盖 | 修改材质属性 |
| UV Morph | UV 坐标偏移 | 修改 UV 层 |
| Group Morph | 多个 morph 组合 | slider 影响多个子 morph |

```python
# core/morph.py (MigrationFnMorph)
# 迁移旧版本 morph 数据
# update_mmd_morph() 检查并更新 morph 格式
```

---

## 7. Property 系统详解

### 7.1 Blender PropertyGroup 模式

```python
# properties/material.py
class MMDMaterial(PropertyGroup):
    # 颜色属性
    ambient_color = FloatVectorProperty(
        name='Ambient Color',
        subtype='COLOR',
        size=3,
        update=_updateAmbientColor,  # 更新回调
    )
    diffuse_color = FloatVectorProperty(...)
    specular_color = FloatVectorProperty(...)
    alpha = FloatProperty(name='Alpha', min=0, max=1)

    # 枚举标志
    sphere_texture_type = EnumProperty(
        items=[
            (0, 'Off', ''),
            (1, 'Multiply', ''),
            (2, 'Add', ''),
            (3, 'SubTexture', ''),
        ]
    )

    # 纹理路径
    toon_texture = StringProperty(
        name='Toon Texture',
        subtype='FILE_PATH',
    )

    # 共享 toon 纹理（0-9 共 10 个预设）
    shared_toon_texture = IntProperty(name='Shared Toon Texture', min=0, max=9)
```

### 7.2 Update 回调模式

```python
def _updateDiffuseColor(self, context):
    # 颜色改变时自动更新材质
    mat = self.id_data
    mat.diffuse_color = self.diffuse_color
```

**对 MikuMikuAR 的启发**: 可以用 TypeScript 的 `Proxy` 或 `defineProperty` 实现类似的响应式属性更新。

### 7.3 属性注册到 Blender 类型

```python
# properties/__init__.py
bpy.types.Object.mmd_type = EnumProperty(...)
bpy.types.Object.mmd_root = PointerProperty(type=MMDRoot)
bpy.types.Object.mmd_rigid = PointerProperty(type=MMDRigid)
bpy.types.PoseBone.mmd_bone = PointerProperty(type=MMDBone)
bpy.types.Material.mmd_material = PointerProperty(type=MMDMaterial)
```

**对 MikuMikuAR 的启发**: 类似地将数据"挂载"到 Babylon.js 的 `AbstractMesh` 或 `Node` 上：

```typescript
// 概念上的类比
mesh.mmd = new MMDModelData();
mesh.mmd.bones = new Map<string, MMDBone>();
mesh.mmd.materials = new Map<string, MMDMaterial>();
```

---

## 8. Operator 模式（命令系统）

### 8.1 Blender Operator 结构

```python
# operators/fileio.py
@register_wrap  # 拓扑排序注册装饰器
class ImportPmx(Operator, ImportHelper):
    bl_idname = 'mmd_tools.import_model'
    bl_label = 'Import Model File (.pmd, .pmx)'
    bl_description = 'Import model file(s), supported format: pmd and pmx.'
    bl_options = {'REGISTER', 'UNDO', 'PRESET'}  # UI显示 + 撤销 + 预设支持

    # 属性定义
    scale = FloatProperty(name='Scale', default=1.0)
    types = EnumProperty(
        name='Types',
        options={'ENUM_FLAG'},  # 多选
        items=[
            ('MESH', 'Mesh', 'Mesh', 1),
            ('ARMATURE', 'Armature', 'Armature', 2),
            ('PHYSICS', 'Physics', 'Rigidbodies and joints', 4),
        ],
        default={'MESH', 'ARMATURE', 'PHYSICS'},
    )

    def invoke(self, context, event):
        # 弹出文件选择对话框
        return ImportHelper.invoke(self, context, event)

    def execute(self, context):
        try:
            importer = PMXImporter()
            importer.execute(self.filepath, scale=self.scale, types=self.types)
            self.report({'INFO'}, f'Imported: {self.filepath}')
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, str(e))
            return {'CANCELLED'}
```

**Operator bl_options 含义**:
- `REGISTER`: 在 UI 中显示
- `UNDO`: 操作可撤销
- `PRESET`: 支持保存/加载预设

### 8.2 关键 Operator 一览

| Operator | 作用 | 关键参数 |
|----------|------|---------|
| `mmd_tools.import_model` | 导入 PMX/PMD | scale, types, rename_bones |
| `mmd_tools.export_pmx` | 导出 PMX | |
| `mmd_tools.import_vmd` | 导入 VMD 动作 | bone_mapper, margin |
| `mmd_tools.export_vmd` | 导出 VMD 动作 | |
| `mmd_tools.build_rig` | 构建物理 rig | |
| `mmd_tools.morph_slider_setup` | 创建 morph slider UI | type: CREATE/BIND/UNBIND |
| `mmd_tools.convert_materials_for_cycles` | 转换材质到 Cycles | |
| `mmd_tools.separate_by_materials` | 按材质分离网格 | |

### 8.3 对 MikuMikuAR 的启发

```typescript
// 类比 Blender Operator 的命令模式
interface MMDCommand {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly options: CommandOptions; // REGISTER, UNDO, PRESET

  // 方法签名参考 mmd_tools
  canExecute(context: MMDContext): boolean;
  execute(context: MMDContext): CommandResult;
  invoke?(context: MMDContext, event: UIEvent): Promise<CommandResult>;

  // 属性定义
  props: CommandProperty[];
}

// 注册到命令系统
@registerCommand({ id: 'mmd_tools.import_model', ... })
class ImportPmxCommand implements MMDCommand {
  scale = 1.0;
  types = ['MESH', 'ARMATURE', 'PHYSICS'];
  // ...
}
```

---

## 9. Panel 模式（UI）

### 9.1 Panel 基类

```python
class _PanelBase(object):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'  # Blender 2.80+ 用 UI region
    bl_category = 'MMD'   # 侧边栏 Tab 名称

@register_wrap
class MMDToolsObjectPanel(_PanelBase, Panel):
    bl_idname = 'OBJECT_PT_mmd_tools_object'
    bl_label = 'MMD Tools'

    @classmethod
    def poll(cls, context):
        # 只有选中 MMD 模型时才显示
        return mmd_model.Model.findRoot(context.active_object) is not None

    def draw(self, context):
        layout = self.layout
        # layout.column() / layout.row() / layout.operator() ...
```

### 9.2 面板布局示例

```python
def draw(self, context):
    layout = self.layout

    # 分栏布局
    col = layout.column(align=True)  # align=True 对齐列
    col.operator('mmd_tools.import_model', text='Import', icon='OUTLINER_OB_ARMATURE')

    # 行布局
    row = layout.row(align=True)
    row.operator('mmd_tools.set_glsl_shading', text='GLSL')
    row.operator('mmd_tools.set_shadeless_glsl_shading', text='Shadeless')

    # 列表（UIList）
    layout.template_list('MMDMorphUIList', '', ...)

    # 属性搜索
    layout.prop_search(obj, 'mmd_bone.name_j', context.scene, 'objects')
```

### 9.3 对 MikuMikuAR 的启发

```tsx
// React 类比 mmd_tools panel 模式
const MMDToolsPanel: React.FC = () => {
  const context = useMMDContext();

  // poll 逻辑
  if (!context.selectedModel) return null;

  return (
    <PanelLayout category="MMD">
      <Column align>
        <OperatorButton command="mmd_tools.import_model" />
        <Row align>
          <Button command="set_glsl_shading" label="GLSL" />
          <Button command="set_shadeless_glsl_shading" label="Shadeless" />
        </Row>
        <MorphList model={context.selectedModel} />
      </Column>
    </PanelLayout>
  );
};
```

---

## 10. VMD 动作导入

`core/vmd/__init__.py` (~370行) 定义 VMD 格式读取：

```python
class Motion:
    animation_data: Dict[str, Any]  # bone_name -> keyframes

class VMDReader:
    def read(self, filepath: str) -> Motion:
        # 二进制格式解析
        # 返回 bone 动画 + morph 动画
```

VMD 导入时使用 `bone_mapper` 参数处理骨骼名映射：
- `BLENDER`: Blender 骨骼名
- `PMX`: 日文 MMD 骨骼名
- `RENAMED_BONES`: 已重命名为 Blender 风格的骨骼名

---

## 11. Material 系统细节

mmd_tools 的材质支持：

```python
# 核心属性
diffuse_color       # 漫反射
specular_color      # 高光
ambient_color       # 环境光
shininess           # 光泽度 (0-512)
alpha               # 透明度
is_double_sided     # 双面渲染

# 特殊纹理
sphere_texture_type # OFF/MULT/ADD/SUBTEX (球谐纹理叠加模式)
toon_texture        # 卡通纹理路径
shared_toon_texture # 共享 toon 纹理编号 (0-9)

# 渲染选项
enabled_drop_shadow # 地面阴影
```

球谐纹理叠加模式（MMD 特有）:
- `Multiply`: 正片叠底
- `Add`: 加法叠加
- `SubTexture`: 减法

Toon Shader 渲染支持共享纹理（0-9 共 10 个内置）和自定义纹理。

---

## 12. 物理系统

### 12.1 刚体类型

| 类型 | MMD 含义 | Blender Physics |
|------|---------|----------------|
| STATIC | 静止物体 | Rigid Body, mass=0 |
| DYNAMIC | 物理动态物体 | Rigid Body, mass>0 |
| DYNAMIC_BONE | 骨骼关联物理 | Rigid Body + Bone parent |

### 12.2 Joint 约束

```python
# core/model.py::buildJoints()
# 创建 Spring Joint（锥形弹簧约束）
# 参数: location, rotation, translation_lim, rotation_lim, spring
```

---

## 13. 可直接复用的算法

### 13.1 SDEF → BDEF2 转换

```python
# 将 SDEF 特殊变形转换为 Blender 可用的 BDEF2 权重
# SDEF 有额外的 C, R0, R1 向量参数
# mmd_tools 直接丢弃这些向量，只保留权重
```

### 13.2 顶点去重与清理

```python
# core/pmx/importer.py::_PMXCleaner
# 1. 移除未使用顶点
# 2. 合并位置+UV都相同的顶点
# 3. 更新 morph offsets 到新索引
```

### 13.3 UV V 坐标翻转

```python
# Blender 的 UV 原点在左下，MMD 在左上
# 导入时 V = 1.0 - V
# 导出时 V = 1.0 - V
```

---

## 14. 架构决策建议（对 MikuMikuAR）

### 建议 1: 复用 mmd_tools 的分层思想

```
数据层 (core/)    → TypeScript 模型类（PMXModel, Bone, Morph, Material...）
命令层 (operators/) → Command 模式（ImportCommand, ExportCommand...）
属性层 (properties/) → Reactive 属性（带 update callback）
UI层 (panels/)     → React 组件（上下文敏感）
```

### 建议 2: 双命名 + ID 映射

```typescript
// 所有 MMD 实体同时使用 name_j 和整数 ID
interface MMDEntity {
  id: number;      // 唯一整数 ID（MMD 原生）
  name_j: string; // 日文名（用于显示和匹配）
  name_e?: string; // 英文名（用于搜索）
}
```

### 建议 3: 导入管道模式

```typescript
// 仿 mmd_tools 的分阶段导入
class PMXImporter {
  async import(ctx: ImportContext): Promise<ImportedModel> {
    const pmx = await this.parsePmx(ctx.file);
    const obj = this.createObjects(pmx);
    this.importVertices(obj, pmx);    // 顶点 + 骨权重
    this.importMaterials(obj, pmx);    // 材质
    this.importFaces(obj, pmx);       // 面
    this.importBones(obj, pmx);       // 骨骼层级 + IK
    this.importMorphs(obj, pmx);      // Morph 系统
    this.importPhysics(obj, pmx);     // 刚体 + 关节
    return obj;
  }
}
```

### 建议 4: 命令撤销系统

mmd_tools 的每个 Operator 都支持 UNDO。MikuMikuAR 的 Web 端可以用类似 Babylon.js 的 `UndoStack` 或自定义实现：

```typescript
interface UndoableCommand extends Command {
  undo(): void;
  redo(): void; // 等价于 execute()
}
```

### 建议 5: 物理集成策略

mmd_tools 用 Blender 内置 physics。MikuMikuAR 需要集成 WASM Bullet：

```typescript
// 层级对应
Blender RigidBodyWorld    →  WASM Bullet World
Blender Rigid Body        →  btRigidBody + Mesh (可视/不可视)
Blender Constraint        →  btTypedConstraint
```

---

## 15. 未涉及的模块

以下模块本次未深入分析，可作为后续研究：
- `core/vmd/exporter.py` - VMD 导出
- `core/vpd/` - VPD pose 读写
- `core/camera.py` - MMD 相机数据迁移
- `operators/animation.py` - 骨骼动画操作
- `cycles_converter.py` - Cycles 渲染器材质转换
- `externals/` - 外部工具目录（本版本为空）

---

## 16. 参考链接

- MMD Tools GitHub: https://github.com/MMD-Blender/blender_mmd_tools
- MMD Tools Fandom Wiki: https://mmd-blender.fandom.com/wiki/MMD_Tools
- PMX 格式规范: 参见 mmd_tools/core/pmx/__init__.py 数据结构注释
- VMD 格式规范: 参见 mmd_tools/core/vmd/__init__.py