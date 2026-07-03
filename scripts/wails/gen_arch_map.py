"""
前端架构图自动生成器
扫描 src/ 目录，分析 import/export，生成架构概览文档。

用法:
    python scripts/gen_arch_map.py

输出:
    docs/architecture-map.md
"""

import os
import re
import sys
from pathlib import Path
from collections import defaultdict


ROOT = Path(__file__).resolve().parent.parent  # MikuMikuAR/
SRC = ROOT / "frontend" / "src"
OUTPUT = ROOT.parent / "docs" / "architecture-map.md"

# 目录 → 职责描述（按目录聚合）
DIR_DESC = {
    "core": "核心层：共享状态、配置、工具函数、文件服务、图标",
    "scene": "渲染层：3D场景、模型加载、VMD播放、环境系统、物理",
    "menus": "UI层：菜单弹窗、模型库、设置、属性面板",
    "outfit": "业务层：换装系统、音频播放",
    "physics": "物理层：XPBD布料、碰撞体",
    "motion": "动效层：程序化动作、节拍检测、LipSync、VPD解析、VMD写入",
    "__tests__": "测试层：单元测试、集成测试",
    "assets": "资源层：字体、图片等静态资源",
}

# 关键文件名 → 一句话职责（用于细化）
FILE_DESC = {
    # core/
    "main.ts": "应用入口：事件绑定、快捷键、初始化调度",
    "config.ts": "全局状态：共享变量、DOM引用、类型定义、工具函数",
    "fileservice.ts": "文件服务：统一URL解析、HTTP服务器代理",
    "icons.ts": "图标注册表：Iconify 图标映射",
    "ui-helpers.ts": "UI构建器：slideRow、toggleRow、sliderRow 等DOM构建函数",

    # scene/
    "scene.ts": "场景核心：装配器，按顺序初始化所有子系统",
    "scene-model.ts": "模型管理器：注册表、生命周期、属性管理",
    "scene-material.ts": "材质系统：按部位分类、批量调参、状态持久化",
    "scene-vmd.ts": "VMD加载：动作/相机/姿势加载与绑定",
    "scene-playback.ts": "播放控制：进度条、seek、UI更新",
    "scene-proc-motion.ts": "程序化动作：Idle Motion / Auto Dance",
    "scene-lipsync.ts": "口型同步：音频振幅→Morph权重映射",
    "scene-props.ts": "道具系统：道具加载、变换、列表管理",
    "scene-serialize.ts": "场景序列化：保存/加载、自动保存、场景还原",
    "scene-model-ops.ts": "模型操作：可见性/变换/物理/Morph等便捷函数",
    "scene-env.ts": "环境门面：统一环境API入口",
    "scene-env-impl.ts": "环境核心：天空、地面、观察者、雾、时之砂",
    "scene-env-water.ts": "水面系统：Gerstner波、涟漪、焦散、水下过渡",
    "scene-env-clouds.ts": "云层系统：体积云、Perlin噪声",
    "scene-env-particles.ts": "粒子系统：樱花/雨/雪/风",
    "scene-env-bridge.ts": "环境桥接：envAutoLink、太阳角、时间流转、重力",
    "scene-lighting.ts": "光照系统：灯光、阴影、太阳盘、环境光",
    "scene-renderer.ts": "渲染管线：后处理、渲染参数、SSAO/辉光",
    "scene-loader.ts": "模型加载：PMX加载流程、错误处理、进度反馈",
    "camera.ts": "相机系统：轨道/自由飞行/镜头预设/演唱会模式",
    "env-lighting.ts": "环境光照推导：天空色→光照参数自动计算",

    # menus/
    "menu.ts": "MenuStack：通用菜单导航组件",
    "library.ts": "模型库入口：弹窗开关、初始化、刷新",
    "library-core.ts": "模型库核心：扫描、搜索、层级构建、标签",
    "model-detail.ts": "模型详情：信息、变换、可见性、表情、材质",
    "model-material.ts": "材质调节：逐材质调参子菜单",
    "model-preset.ts": "模型预设：保存/加载/自动应用",
    "scene-menu.ts": "场景菜单：相机、灯光、渲染、音乐、程序化动作",
    "motion-popup.ts": "动作库弹窗：VMD、姿势、舞蹈套装",
    "env-menu.ts": "环境菜单：天空、地面、粒子、风、云",
    "settings.ts": "设置页：外部库管理、偏好配置",
    "outfit-ui.ts": "换装UI：服装变体子菜单",

    # outfit/
    "outfit.ts": "换装系统：outfits.json加载、变体应用、重置",
    "audio.ts": "音频系统：音乐播放、VMD同步、节拍检测挂载",

    # motion/
    "procedural-motion.ts": "程序化动作：Idle Motion / Auto Dance 核心算法",
    "beat-detector.ts": "节拍检测：Web Audio API 实时BPM检测",
    "lipsync.ts": "口型同步：音频振幅分析",
    "vpd-parser.ts": "VPD姿势解析：MikuMikuPose 格式→VMD帧转换",
    "vmd-writer.ts": "VMD写入：程序化动作生成二进制VMD",

    # physics/
    "xpbd-cloth.ts": "XPBD布料：布料模拟核心算法",
    "xpbd-collider.ts": "碰撞体：SDF碰撞体、胶囊体预设",
    "xpbd-solver.ts": "XPBD求解器：约束求解核心",
    "xpbd-renderer.ts": "布料渲染：布料网格可视化",
    "cloth-manager.ts": "布料管理器：布料实例生命周期管理",

    # root/
    "app.css": "全局样式：CSS变量体系、组件样式、布局",
    "vite-env.d.ts": "Vite类型声明：环境变量类型、模块声明",

    # __tests__/
    "beat-detector.test.ts": "节拍检测单元测试",
    "config.test.ts": "配置工具函数单元测试",
    "env-lighting.test.ts": "环境光照推导单元测试",
    "env-state-integrity.test.ts": "环境状态完整性测试",
    "env-state.test.ts": "环境状态单元测试",
    "environment-integration.test.ts": "环境系统集成测试",
    "lipsync.test.ts": "口型同步单元测试",
    "material-editor.test.ts": "材质编辑器测试",
    "model-detail-ui.test.ts": "模型详情UI测试",
    "model-preset.test.ts": "模型预设功能测试",
    "outfit.test.ts": "换装系统单元测试",
    "procedural-motion.test.ts": "程序化动作单元测试",
    "vmd-writer.test.ts": "VMD写入器单元测试",
    "vpd-parser.test.ts": "VPD解析器单元测试",
    "xpbd-cloth.test.ts": "XPBD布料模拟单元测试",
    "xpbd-solver.test.ts": "XPBD求解器单元测试",
}


def read_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def parse_imports(content: str) -> list[tuple[str, bool]]:
    """解析 import 语句，返回 [(模块路径, 是否type-only)]"""
    imports = []
    # import { x } from "..."
    for m in re.finditer(r'import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["\']([^"\']+)["\']', content):
        imports.append((m.group(1), "type" in m.group(0)[:20]))
    # import type { x } from "..."
    for m in re.finditer(r'import\s+type\s+\{[^}]*\}\s+from\s+["\']([^"\']+)["\']', content):
        if (m.group(1), True) not in imports:
            imports.append((m.group(1), True))
    return imports


def parse_exports(content: str) -> list[str]:
    """解析 export 的名称（粗略）"""
    names = []
    # export function / const / let / class / type
    for m in re.finditer(r'^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+(\w+)', content, re.MULTILINE):
        names.append(m.group(1))
    # export { a, b } from "..."
    for m in re.finditer(r'^export\s+\{([^}]+)\}\s+from', content, re.MULTILINE):
        for name in m.group(1).split(","):
            name = name.strip().split(" as ")[0].strip()
            if name:
                names.append(name)
    # export * from "..."
    if re.search(r'^export\s+\*\s+from', content, re.MULTILINE):
        names.append("*")
    return names


def resolve_rel_path(from_file: Path, mod_path: str) -> Path | None:
    """把相对 import 路径解析为绝对文件路径"""
    if not mod_path.startswith("."):
        return None  # 外部依赖
    base = from_file.parent
    target = (base / mod_path).resolve()
    # 尝试 .ts / .tsx / index.ts
    for ext in [".ts", ".tsx", ""]:
        p = target.with_suffix(ext) if ext else target
        if p.is_file():
            return p
        if p.is_dir():
            idx = p / "index.ts"
            if idx.is_file():
                return idx
    return None


def classify_file(path: Path) -> str:
    """返回文件所属目录分类"""
    rel = path.relative_to(SRC)
    parts = rel.parts
    if len(parts) >= 2:
        return parts[0]  # 一级目录
    return "root"


def main():
    # 收集所有 .ts / .tsx / .css 文件
    ts_files = []
    for p in SRC.rglob("*.ts"):
        if "node_modules" in p.parts:
            continue
        ts_files.append(p)
    for p in SRC.rglob("*.tsx"):
        if "node_modules" in p.parts:
            continue
        ts_files.append(p)
    for p in SRC.rglob("*.css"):
        if "node_modules" in p.parts:
            continue
        ts_files.append(p)

    ts_files.sort()

    # 按目录分组
    by_dir = defaultdict(list)
    for f in ts_files:
        d = classify_file(f)
        by_dir[d].append(f)

    # 分析每个文件的 import/export
    file_info = {}
    for f in ts_files:
        content = read_file(f)
        imps = parse_imports(content)
        exps = parse_exports(content)
        # 统计内部依赖数量
        internal_deps = 0
        external_deps = 0
        for mod, is_type in imps:
            if mod.startswith("."):
                internal_deps += 1
            else:
                external_deps += 1
        rel = f.relative_to(SRC).as_posix()
        file_info[rel] = {
            "imports": imps,
            "exports": exps,
            "internal_deps": internal_deps,
            "external_deps": external_deps,
            "loc": len(content.splitlines()),
        }

    # 生成文档
    lines = []
    lines.append("# 前端架构图（自动生成）")
    lines.append("")
    lines.append("> 本文件由 `scripts/gen_arch_map.py` 自动生成，请勿手动编辑。")
    lines.append(f"> 扫描范围：`frontend/src/`，共 {len(ts_files)} 个源文件（TS/CSS）")
    lines.append("")

    # ===== 统计概览 =====
    lines.append("## 📊 统计概览")
    lines.append("")
    total_loc = sum(v["loc"] for v in file_info.values())
    lines.append(f"- **文件总数**：{len(ts_files)}")
    lines.append(f"- **代码总行数**：约 {total_loc:,} 行")
    lines.append(f"- **目录数**：{len(by_dir)}")
    lines.append("")

    # 统计 assets 目录资源文件
    assets_dir = SRC / "assets"
    assets_count = 0
    assets_size = 0
    if assets_dir.is_dir():
        for p in assets_dir.rglob("*"):
            if p.is_file():
                assets_count += 1
                assets_size += p.stat().st_size

    # 各目录统计
    lines.append("### 按目录统计")
    lines.append("")
    lines.append("| 目录 | 文件数 | 行数 | 职责 |")
    lines.append("|------|--------|------|------|")
    for d in sorted(by_dir.keys()):
        files = by_dir[d]
        loc = sum(file_info[f.relative_to(SRC).as_posix()]["loc"] for f in files)
        if d == "root":
            desc = "根目录：全局样式、类型声明"
            lines.append(f"| `(root)` | {len(files)} | {loc:,} | {desc} |")
        else:
            desc = DIR_DESC.get(d, "")
            lines.append(f"| `{d}/` | {len(files)} | {loc:,} | {desc} |")
    if assets_count > 0:
        size_str = f"{assets_size/1024:.1f} KB" if assets_size < 1024*1024 else f"{assets_size/1024/1024:.2f} MB"
        lines.append(f"| `assets/` | {assets_count} | — ({size_str}) | {DIR_DESC.get('assets', '')} |")
    lines.append("")

    # ===== 分层架构 =====
    lines.append("## 🏗️ 分层架构")
    lines.append("")
    lines.append("```")
    lines.append("┌─────────────────────────────────────────────────┐")
    lines.append("│  测试层 (__tests__/)                           │")
    lines.append("│  单元测试、集成测试、回归测试                    │")
    lines.append("└───────────────────┬─────────────────────────────┘")
    lines.append("                    │ 测试")
    lines.append("┌───────────────────▼─────────────────────────────┐")
    lines.append("│  UI 层 (menus/)                                │")
    lines.append("│  模型库、设置、详情面板、场景菜单、环境菜单      │")
    lines.append("└───────────────────┬─────────────────────────────┘")
    lines.append("                    │ 调用")
    lines.append("┌───────────────────▼─────────────────────────────┐")
    lines.append("│  业务层 (outfit/ motion/)                      │")
    lines.append("│  换装、音频、程序化动作、LipSync、节拍检测      │")
    lines.append("└───────────────────┬─────────────────────────────┘")
    lines.append("                    │ 依赖")
    lines.append("┌───────────────────▼─────────────────────────────┐")
    lines.append("│  渲染层 (scene/)                               │")
    lines.append("│  3D场景、模型加载、VMD播放、环境系统、光照渲染  │")
    lines.append("└───────────────────┬─────────────────────────────┘")
    lines.append("                    │ 共享")
    lines.append("┌───────────────────▼─────────────────────────────┐")
    lines.append("│  核心层 (core/)                                │")
    lines.append("│  全局状态、工具函数、文件服务、图标、入口       │")
    lines.append("└───────────────────┬─────────────────────────────┘")
    lines.append("                    │ 支撑")
    lines.append("┌───────────────────▼─────────────────────────────┐")
    lines.append("│  资源层 (assets/)                               │")
    lines.append("│  字体、图片、图标等静态资源                      │")
    lines.append("└─────────────────────────────────────────────────┘")
    lines.append("```")
    lines.append("")

    # ===== 各目录详情 =====
    lines.append("## 📁 各模块详情")
    lines.append("")

    # 按一定顺序展示：core → scene → menus → outfit → motion → physics → __tests__ → (root) → assets
    display_order = ["core", "scene", "menus", "outfit", "motion", "physics", "__tests__", "root"]

    for d in display_order:
        if d not in by_dir:
            continue
        files = by_dir[d]
        if d == "root":
            lines.append("### `(root)`")
            lines.append("")
            lines.append("> 根目录：全局样式、类型声明、入口HTML")
        else:
            lines.append(f"### `{d}/`")
            if d in DIR_DESC:
                lines.append("")
                lines.append(f"> {DIR_DESC[d]}")
        lines.append("")
        lines.append("| 文件 | 行数 | 导出数 | 内部依赖 | 职责 |")
        lines.append("|------|------|--------|----------|------|")
        for f in sorted(files, key=lambda x: x.name):
            rel = f.relative_to(SRC).as_posix()
            info = file_info[rel]
            name = f.name
            exp_count = len(info["exports"])
            if "*" in info["exports"]:
                exp_str = f"{exp_count-1} + *"
            else:
                exp_str = str(exp_count)
            desc = FILE_DESC.get(name, "")
            lines.append(f"| `{name}` | {info['loc']:,} | {exp_str} | {info['internal_deps']} | {desc} |")
        lines.append("")

    # assets 目录（如果有）
    if assets_count > 0:
        lines.append("### `assets/`")
        lines.append("")
        lines.append(f"> {DIR_DESC.get('assets', '')}")
        lines.append("")
        lines.append("| 子目录/文件 | 数量 | 说明 |")
        lines.append("|-------------|------|------|")
        if assets_dir.is_dir():
            for item in sorted(assets_dir.iterdir()):
                if item.is_dir():
                    file_count = sum(1 for p in item.rglob("*") if p.is_file())
                    lines.append(f"| `{item.name}/` | {file_count} | |")
                else:
                    lines.append(f"| `{item.name}` | 1 | |")
        lines.append("")

    # ===== 循环依赖检测 =====
    lines.append("## 🔄 循环依赖")
    lines.append("")
    lines.append("> 由 `madge --circular` 检测。部分循环依赖为**设计上故意**（子模块从 scene.ts 导入，scene.ts 又 re-export 子模块），")
    lines.append("> 但仅在函数体内访问，利用 ES module live binding 保证运行时安全。")
    lines.append("")

    # 用 madge 结果（手动整理的，因为 madge 输出是文本）
    lines.append("### 已知循环依赖（运行时安全）")
    lines.append("")
    lines.append("| 循环 | 说明 | 风险 |")
    lines.append("|------|------|------|")
    lines.append("| `scene.ts` ↔ `scene-lighting.ts` | lighting 从 scene 拿 scene 对象，scene re-export lighting | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-renderer.ts` | renderer 从 scene 拿 scene 对象，scene re-export renderer | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-loader.ts` | loader 从 scene 拿 modelManager，scene re-export loader | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-env-bridge.ts` | bridge 从 scene 拿 _updateSunDisc，scene re-export bridge | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-proc-motion.ts` | proc 从 scene 拿模型，scene re-export proc | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-lipsync.ts` | lipsync 从 scene 拿 morph，scene re-export lipsync | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-props.ts` | props 从 scene 拿 scene 对象，scene re-export props | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-serialize.ts` | serialize 从 scene 拿状态，scene re-export serialize | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `scene-model-ops.ts` | ops 从 scene 拿 modelManager，scene re-export ops | ✅ 安全 |")
    lines.append("| `scene.ts` ↔ `camera.ts` | camera 从 scene 拿 canvas，scene import camera 函数 | ✅ 安全 |")
    lines.append("| `scene-env.ts` ↔ `scene-env-impl.ts` | 门面模式，impl 持有状态，env 委托 | ✅ 安全 |")
    lines.append("| `scene-env-impl.ts` ↔ `scene-env-water.ts` | water 从 impl 拿 _envSys，impl re-export water | ✅ 安全 |")
    lines.append("| `scene-env-impl.ts` ↔ `scene-env-clouds.ts` | clouds 从 impl 拿 _envSys，impl re-export clouds | ✅ 安全 |")
    lines.append("| `scene-env-impl.ts` ↔ `scene-env-particles.ts` | particles 从 impl 拿 _envSys，impl re-export particles | ✅ 安全 |")
    lines.append("")
    lines.append("**安全判据**：子模块仅在**函数体内**访问 scene.ts 的导出，模块顶层不调用。")
    lines.append("")

    # ===== 核心模块导出索引 =====
    lines.append("## 📑 核心模块导出索引")
    lines.append("")
    lines.append("> 仅列出 scene/ 目录下的导出，便于快速查找。")
    lines.append("")

    for f in sorted(by_dir.get("scene", []), key=lambda x: x.name):
        rel = f.relative_to(SRC).as_posix()
        info = file_info[rel]
        if not info["exports"]:
            continue
        lines.append(f"### `{f.name}`")
        lines.append("")
        # 分组展示
        named = [e for e in info["exports"] if e != "*"]
        has_star = "*" in info["exports"]
        if named:
            lines.append("```typescript")
            for e in named[:30]:  # 最多显示 30 个
                lines.append(f"  {e}")
            if len(named) > 30:
                lines.append(f"  ... 还有 {len(named)-30} 个")
            lines.append("```")
        if has_star:
            lines.append("")
            lines.append("> `export *` — 转发子模块全部导出")
        lines.append("")

    # ===== 依赖最复杂的 Top 10 =====
    lines.append("## 📈 依赖复杂度 Top 10")
    lines.append("")
    lines.append("> 按内部依赖数量排序，依赖越多的文件越需要关注。")
    lines.append("")
    lines.append("| 排名 | 文件 | 内部依赖 | 外部依赖 | 行数 |")
    lines.append("|------|------|----------|----------|------|")
    sorted_by_deps = sorted(file_info.items(), key=lambda x: x[1]["internal_deps"], reverse=True)
    for i, (rel, info) in enumerate(sorted_by_deps[:10], 1):
        name = Path(rel).name
        lines.append(f"| {i} | `{name}` | {info['internal_deps']} | {info['external_deps']} | {info['loc']:,} |")
    lines.append("")

    # ===== 生成时间 =====
    lines.append("---")
    lines.append("")
    lines.append(f"*自动生成于 {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*")
    lines.append("")

    # 写入
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅ 架构图已生成: {OUTPUT}")
    print(f"   文件数: {len(ts_files)}, 总行数: {total_loc:,}")


if __name__ == "__main__":
    main()
