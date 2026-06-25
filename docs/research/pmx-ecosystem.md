# PMX 全平台加载方案全景调研

> 从 research-notes.txt 提取整理。调研 GitHub 上 MMD/PMX 的全平台加载方案，按实用路径梳理。

## 🥇 Web 端：天然跨平台

### 1. babylon-mmd — 目前最完整的 PMX 运行时

- **仓库**：[liudpfork/babylon-mmd](https://github.com/noname0310/babylon-mmd)（npm: `babylon-mmd`）
- Babylon.js 生态，支持 PMX/PMD + VMD/VPD
- 功能完整度最高：

| 能力 | 状态 |
|------|------|
| PMX / PMD 加载 | ✅ |
| VMD / VPD 动画 | ✅ |
| IK 求解 | ✅ |
| Append Transform（Grant） | ✅ |
| Morph 表情系统 | ✅ |
| 物理刚体/关节 | ✅（WASM-based Bullet） |
| SDEF 球形变形 | ✅（含 shadow 兼容处理） |
| 音频同步播放 | ✅ |
| WebGL 1/2 + WebGPU | ✅ |
| 优化自定义格式 BPMX/BVMD | ✅（跳过解析开销、保护原始文件） |

```ts
import "babylon-mmd/esm/Loader/pmxLoader";
const mmdMesh = await ImportMeshAsync("miku.pmx", scene)
  .then(r => r.meshes[0]);
```

适合：做一个真正的 MMD viewer/播放器。Web 发布 = Windows/Mac/Linux/iOS/Android 全覆盖。

### 2. Three.js 官方 MMDLoader

- 内置在 `three/addons/loaders/MMDLoader.js`
- 零额外依赖，但功能深度不如 babylon-mmd（物理/IK 精度、SDEF 等短板）
- 需要配 ammo.js（Bullet 的 JS 端口）才能跑物理
- ⚠️ Three.js r172 已将 MMDLoader 移出核心库

### 3. three-mmd-loader — Three.js 现代封装版

- **仓库**：[hanakla/three-mmd-loader](https://github.com/hanakla/three-mmd-loader)（npm: `three-mmd-loader`）
- 基于官方 MMDLoader 做 TypeScript 重写 + ESM 模块化
- API 改为 Promise 风格：
```ts
const loader = new MMDLoader();
const mesh = await loader.load("miku.pmx", ["motion.vmd"]);
```

## 🥈 C/C++ 原生跨平台

### 4. MikuMikuFormats — 纯 C++ PMX/PMD/VMD 解析库

- **仓库**：[newpolaris/MMDFormats](https://github.com/newpolaris/MMDFormats)（CC0 许可）
- 纯 C++11/14，`std::ifstream` 读二进制 PMX
- PMX ver 2.0（partial 2.1），VMD，PMD
- CMake 构建，不绑任何渲染引擎
- 字符编码：Win 走 Win32API，Unix 走 ICU（UTF-16LE → UTF-8）
- 原作者建议走 assimp 维护的版本

### 5. Assimp（Open Asset Import Library）

- 对 PMX 的支持间接/不完整，morph、IK、物理刚体语义会丢
- 适合做"导入 → 转 glTF → 再渲染"管线，不适合还原 MMD 行为

## 🥉 引擎集成路线

| 引擎 | 项目 | 备注 |
|------|------|------|
| Godot 4 | V-Sekai/godot-pmx | C++ module / GDExtension，PMX 导入为 PackedScene |
| Unity | Chaika9/PMXLoaderUnity | PMX→SkeletalMesh，VMD→Animation，Bullet 物理 |
| Unreal 5 | Ghx86/VP_Loader | UE5 plugin，PMX 骨骼/IK/VMD 相机动画 |
| Unreal 5 | PMX Importer plugin | SkeletalMesh + MorphTarget + PhysicsAsset |

## 选型速断

| 目标 | 推荐方案 |
|------|----------|
| 一套代码跑所有平台（含手机浏览器） | **babylon-mmd** — 最接近"全平台 PMX 运行时"的交钥匙方案 |
| 已有 Three.js 项目，只想嵌 MMD 模型 | Three.js 自带 MMDLoader 或 three-mmd-loader |
| 自己做引擎，只要解析层 | MikuMikuFormats C++ 解析 → 你接渲染后端 |
| 目标平台是 Godot/Unity/UE | 对应引擎插件，别自己造轮子 |

## 核心结论

> PMX 的"全平台梦想"在现实里 ≈ Web 技术栈。因为 MMD 格式本身就不是为跨平台设计的，它的"全平台"只能靠一层足够厚的运行时抽象（浏览器刚好是最厚的那个沙箱）去抹平。SDEF/QDEF 顶点变形、IK 求解、Append Transform、Bullet 刚体、MMD 专属材质/Toon 贴图/TGA 纹理——这些东西离开原生环境就得全部重新实现。

真正意义上"一份代码 → 全平台"，目前只有 babylon-mmd（Web 技术栈）套壳这条路。
