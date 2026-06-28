# 前端开发快速参考

## 构建命令

```bash
# 前端构建
cd MikuMikuAR/frontend && npx vite build 2>&1

# 开发模式（热更新）
cd MikuMikuAR/frontend && npx vite
```

## 核心文件位置

### 场景相关
- `frontend/src/scene/scene.ts` - 主场景
- `frontend/src/scene/camera.ts` - 相机控制
- `frontend/src/scene/scene-material.ts` - 材质系统
- `frontend/src/scene/scene-model.ts` - 模型管理
- `frontend/src/scene/env-lighting.ts` - 环境光照

### 菜单相关
- `frontend/src/menus/menu.ts` - MenuStack 基础
- `frontend/src/menus/scene-menu.ts` - 场景菜单
- `frontend/src/menus/model-detail.ts` - 模型详情
- `frontend/src/menus/model-material.ts` - 材质调节
- `frontend/src/menus/outfit-ui.ts` - 换装 UI
- `frontend/src/menus/library.ts` - 模型库
- `frontend/src/menus/env-menu.ts` - 环境菜单
- `frontend/src/menus/motion-popup.ts` - 动作库弹窗

### 动作相关
- `frontend/src/motion/procedural-motion.ts` - 程序化动作
- `frontend/src/motion/beat-detector.ts` - 节拍检测
- `frontend/src/motion/vpd-parser.ts` - VPD 姿势
- `frontend/src/motion/lipsync.ts` - LipSync

### 核心服务
- `frontend/src/core/fileservice.ts` - 文件 URL/HTTP 服务器
- `frontend/src/outfit/outfit.ts` - 换装系统
- `frontend/src/outfit/audio.ts` - 音频同步

## 常见任务速查

### 添加新菜单项

1. 读 `docs/menu-architecture.md`
2. 在对应菜单文件添加项（如 `frontend/src/menus/scene-menu.ts`）
3. 实现功能函数
4. 构建验证

**示例**：在场景菜单添加新项
```typescript
// 在 frontend/src/menus/scene-menu.ts 的 buildMainLevel 函数中添加
const newItem = this.ui.createMenuItem('新功能', 'icon-name');
newItem.onclick = () => this.handleNewFeature();
this.ui.addMenuItem(this.stack.currentLevel, newItem);
```

### 修改材质

1. 读 `docs/architecture.md` §材质系统
2. 修改 `frontend/src/scene/scene-material.ts`
3. 测试不同模型

**关键函数**：
- `_catOf(mesh)` - 获取材质分类
- `_applyAll(scene, fn)` - 应用到所有材质
- `setMatParams(mesh, params)` - 设置材质参数

### 修复加载问题

1. 读 `docs/troubleshooting.md`
2. 检查控制台错误
3. 验证文件路径/HTTP 服务器

**常见原因**：
- HTTP 服务器未启动
- 文件路径错误
- CORS 问题
- WASM 404

### 添加换装变体

1. 创建 `outfits.json`
2. 实现纹理加载逻辑
3. 更新 `frontend/src/outfit/outfit.ts`

**outfits.json 格式**：
```json
{
  "modelName": {
    "variantName": {
      "textures": {...}
    }
  }
}
```

## 调试技巧

### 场景不显示
```javascript
// 浏览器控制台
console.log(scene.meshes.length);  // 检查模型是否加载
console.log(scene.materials.length);  // 检查材质
```

### 动作不同步
- 检查音频加载状态
- 验证 VMD 文件格式
- 查看 `syncAudioPlayback` 逻辑

### 材质不生效
- 检查材质索引
- 验证纹理路径
- 查看 `setMatParams` 调用

### 菜单不显示
- 检查 MenuStack 状态
- 验证 CSS 类
- 查看 `build*Level` 函数

## 性能优化

- 使用 `grep` 而非全量读取
- 避免重复构建
- 小步修改，频繁验证
- 利用文档地图快速定位

## TypeScript 注意事项

- 严格模式，禁止 `any`
- 使用 Babylon.js 官方 API
- 遵循命名规范（见 `docs/terminology.md`）

## CSS 类命名

- 菜单项: `menuItem`
- 弹窗: `popup`
- 按钮: `btn`
- 详见 `docs/menu-architecture.md`

## 版本控制

```bash
# 查看最近提交
git log --oneline -5

# 查看状态
git status
```

---

**完整文档**: 见 `../SKILL.md` 和 `docs/` 目录下的文档
