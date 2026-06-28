# VPD 姿势导入 — 实施计划

> **For agentic workers:** 使用 writing-plans skill 编写。各 task 可独立执行。

**目标：** 实现 VPD (Vocaloid Pose Data) 姿势文件的加载、解析与模型应用，让用户可以加载静态姿势到模型上。

**方案：** 解析 VPD 文本格式 → 转换为 VMD 单帧二进制 → 通过现有 `loadVMDMotion` 管线加载。无需依赖 babylon-mmd 对 VPD 的原生支持。

**技术栈：** Wails Go (app.go) + TypeScript (vpd-parser.ts) + babylon-mmd (VmdLoader)

---

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `MikuMikuAR/app.go` | 新增 `SelectVPDPose` binding |
| 修改 | `MikuMikuAR/frontend/src/scene.ts` | 新增 `loadVPDPose` 函数 |
| 创建 | `MikuMikuAR/frontend/src/vpd-parser.ts` | VPD 解析 + VMD 二进制生成 |
| 修改 | `MikuMikuAR/frontend/src/library.ts` | 动作绑定子菜单加"加载姿势" |
| 修改 | `MikuMikuAR/docs/reusables.md` | 追加 `SelectVPDPose` 条目 |

---

### Task 1: VPD 格式确认 + 样板文件创建

- [ ] **Step 1: 确认 VPD 格式**

VPD 是纯文本格式，典型结构如下：

```
Vocaloid Pose Data file
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
Bone1:右肩
    0.051100 0.000000 0.000000
    0.000000 -0.069756 0.000000 0.997564
}
```

各行含义：
- `Bone<N>:<bone_name>` — 骨骼名（Shift-JIS 编码，VPD 文件本身用 Shift-JIS 文本存储）
- 下一行: `x y z` — 位置偏移
- 下一行: `qx qy qz qw` — 旋转四元数
- 骨骼数量不固定，文件末尾 `}` 结束
- 文件可能以 UTF-8 或 Shift-JIS 编码保存

- [ ] **Step 2: 创建 `vpd-parser.ts` 骨架**

```typescript
// vpd-parser.ts — VPD 姿势文件解析器
// 职责: 解析 VPD 文本 → 提取骨骼变换 → 生成 VMD 单帧 ArrayBuffer

export interface VPDPoseBone {
    name: string;     // 骨骼名称（保留原始编码）
    position: [number, number, number];     // x, y, z
    rotation: [number, number, number, number];  // qx, qy, qz, qw
}

export interface VPDPoseData {
    bones: VPDPoseBone[];
}
```

---

### Task 2: VPD 文本解析

- [ ] **Step 1: 实现 `parseVPDText(text: string): VPDPoseData`**

```typescript
export function parseVPDText(text: string): VPDPoseData {
    const bones: VPDPoseBone[] = [];
    // 去掉 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.charCodeAt(0) === 0xFFFE) text = text.slice(1);

    // 按行解析
    const lines = text.split(/\r?\n/);
    let inBody = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line === "{") { inBody = true; continue; }
        if (line === "}") { inBody = false; continue; }
        if (!inBody || line.startsWith("Vocaloid") || line === "") continue;

        // 匹配 BoneN:bone_name
        const boneMatch = line.match(/^Bone\d+:(.+)$/);
        if (boneMatch) {
            const boneName = boneMatch[1].trim();
            // 接下来两行为 position 和 rotation
            const posLine = lines[++i]?.trim();
            const rotLine = lines[++i]?.trim();
            if (!posLine || !rotLine) break;

            const posParts = posLine.split(/\s+/).filter(s => s.length > 0);
            const rotParts = rotLine.split(/\s+/).filter(s => s.length > 0);
            if (posParts.length < 3 || rotParts.length < 4) continue;

            bones.push({
                name: boneName,
                position: [parseFloat(posParts[0]), parseFloat(posParts[1]), parseFloat(posParts[2])],
                rotation: [parseFloat(rotParts[0]), parseFloat(rotParts[1]), parseFloat(rotParts[2]), parseFloat(rotParts[3])],
            });
        }
    }

    return { bones };
}
```

- [ ] **Step 2: 添加编码检测**

VPD 文件的编码通常为 Shift-JIS，但可能为 UTF-8。添加自动检测逻辑：

```typescript
/** 尝试 UTF-8 解码；若失败则假定为 Shift-JIS 并用 TextDecoder 处理 */
export function decodeVPDData(buffer: ArrayBuffer): string {
    // 先尝试 UTF-8
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    // 检查是否包含常见 VPD 签名
    if (text.includes("Vocaloid") || text.includes("\u30dc\u30fc\u30ab\u30ed\u30a4\u30c9")) {
        return text;
    }
    // 回退到 Shift-JIS
    try {
        text = new TextDecoder("shift-jis", { fatal: false }).decode(buffer);
        return text;
    } catch {
        // 最终回退
        return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    }
}
```

- [ ] **Step 3: 编写 VMD 二进制生成器**

VMD 单帧二进制格式（LE = Little Endian）：

| 偏移 | 大小 | 内容 |
|------|------|------|
| 0 | 30 | 签名: `"Vocaloid Motion Data 0002\0"` |
| 30 | 20 | 模型名（全 `\0`，20字节） |
| 50 | 4 | 骨骼关键帧数（uint32 LE） |
| 54 | 可变 | 骨骼关键帧（每帧 39 字节） |
| 54+N*39 | 4 | 表情关键帧数（0，uint32 LE） |

每帧 39 字节：
| 偏移 | 大小 | 内容 |
|------|------|------|
| 0 | 15 | 骨骼名（Shift-JIS，空字节填充） |
| 15 | 4 | 帧号（uint32 LE，设为 0） |
| 19 | 12 | 位置（3 × float32 LE） |
| 31 | 16 | 旋转（4 × float32 LE） |

```typescript
import { encodeVPDBoneName } from "./vpd-parser";

export function poseDataToVmdBuffer(pose: VPDPoseData): ArrayBuffer {
    const BONE_KEYFRAME_SIZE = 39;
    const HEADER_SIZE = 50;
    const count = pose.bones.length;
    const buf = new ArrayBuffer(HEADER_SIZE + count * BONE_KEYFRAME_SIZE + 4);
    const view = new DataView(buf);
    let offset = 0;

    // 签名: "Vocaloid Motion Data 0002\0" (30 bytes)
    const encoder = new TextEncoder();
    const sig = encoder.encode("Vocaloid Motion Data 0002\0");
    for (let i = 0; i < 30; i++) view.setUint8(offset++, sig[i] ?? 0);

    // 模型名: 20 bytes of zeros
    for (let i = 0; i < 20; i++) view.setUint8(offset++, 0);

    // 骨骼关键帧数
    view.setUint32(offset, count, true);
    offset += 4;

    // 每帧数据
    for (const bone of pose.bones) {
        // 骨骼名: 15 bytes Shift-JIS
        const nameBuf = encodeVPDBoneName(bone.name);
        for (let i = 0; i < 15; i++) view.setUint8(offset++, nameBuf[i] ?? 0);

        // 帧号 = 0
        view.setUint32(offset, 0, true);
        offset += 4;

        // 位置 (3 floats)
        view.setFloat32(offset, bone.position[0], true); offset += 4;
        view.setFloat32(offset, bone.position[1], true); offset += 4;
        view.setFloat32(offset, bone.position[2], true); offset += 4;

        // 旋转 (4 floats)
        view.setFloat32(offset, bone.rotation[0], true); offset += 4;
        view.setFloat32(offset, bone.rotation[1], true); offset += 4;
        view.setFloat32(offset, bone.rotation[2], true); offset += 4;
        view.setFloat32(offset, bone.rotation[3], true); offset += 4;
    }

    // 表情关键帧数 = 0
    view.setUint32(offset, 0, true);

    return buf;
}

/** VPD 骨骼名（UTF-8）→ Shift-JIS 字节数组（最多15字节, 空字节填充） */
function encodeVPDBoneName(name: string): Uint8Array {
    const buf = new Uint8Array(15).fill(0);
    try {
        const sjis = new TextEncoder("shift-jis", { NONSTANDARD_allowLegacyEncoding: true }).encode(name);
        for (let i = 0; i < Math.min(sjis.length, 15); i++) buf[i] = sjis[i];
    } catch {
        // fallback: UTF-8
        const utf8 = new TextEncoder().encode(name);
        for (let i = 0; i < Math.min(utf8.length, 15); i++) buf[i] = utf8[i];
    }
    return buf;
}
```

- [ ] **Step 4: 导出公共 API**

```typescript
export function loadVPDFromBuffer(buffer: ArrayBuffer): ArrayBuffer {
    const text = decodeVPDData(buffer);
    const pose = parseVPDText(text);
    return poseDataToVmdBuffer(pose);
}
```

---

### Task 3: Go Binding — SelectVPDPose

- [ ] **Step 1: 在 `app.go` 添加新函数**

位置：跟在 `SelectVMDMotion` 之后（约第 115 行）。

```go
// SelectVPDPose opens a file dialog to select a VPD pose file
func (a *App) SelectVPDPose() (string, error) {
	return a.openFileDialog("选择 VPD 姿势文件", []runtime.FileFilter{
		{DisplayName: "VPD Pose (*.vpd)", Pattern: "*.vpd"},
		{DisplayName: "All Files (*.*)", Pattern: "*.*"},
	})
}
```

- [ ] **Step 2: 更新 `docs/reusables.md`**

在「文件对话框」表格中追加一行：

```
| `SelectVPDPose` | `() (string, error)` | 选择 VPD 姿势文件 |
```

- [ ] **Step 3: 构建验证**

```bash
cd MikuMikuAR && go build ./... 2>&1
```

- [ ] **Step 4: 重建 Wails 绑定**

```bash
cd MikuMikuAR && wails dev
```

等待前端构建完成，确认 `wailsjs/go/main/App.js` 和 `App.d.ts` 已包含 `SelectVPDPose`。

---

### Task 4: scene.ts — loadVPDPose 函数

- [ ] **Step 1: 在 `scene.ts` 末尾添加 `loadVPDPose` 函数**

```typescript
import { loadVPDFromBuffer } from "./vpd-parser";

/**
 * 加载 VPD 姿势文件 → 转为 VMD 单帧 → 通过 loadVMDMotion 应用
 */
export async function loadVPDPose(path: string, targetModelId?: string): Promise<void> {
    if (isLoadingVmd) return;
    setIsLoadingVmd(true);
    try {
        const { url } = await resolveFileUrl(path);
        const poseName = normPath(path).split("/").pop() || "";
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const rawData = await resp.arrayBuffer();

        // VPD → VMD buffer conversion
        const vmdBuffer = loadVPDFromBuffer(rawData);

        // Apply as single-frame VMD animation
        await loadVMDMotion(vmdBuffer, "姿势: " + poseName.replace(/\.vpd$/i, ""), targetModelId);

        const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
        if (foc) {
            // Set special flag so reset knows it's a pose, not a regular VMD
            // (Pose uses same pipeline, so no special flag needed — reset clears it)
            foc.vmdPath = path;
        }
        setStatus(`✓ 姿势: ${poseName}`, true);
    } catch (err) {
        console.error("loadVPDPose:", err);
        setStatus("✗ 姿势加载失败", false);
    } finally {
        setIsLoadingVmd(false);
    }
}
```

- [ ] **Step 2: 构建验证**

```bash
cd MikuMikuAR/frontend && npx vite build 2>&1
```

---

### Task 5: UI — 动作绑定子菜单添加"加载姿势"

- [ ] **Step 1: 在 `library.ts` 的 `buildMotionBindingLevel` 加菜单项**

在「更换动作」下方添加：

```typescript
{ kind: "action", label: "加载姿势 (VPD)", icon: "user", target: `detail:motion:pose:${id}`, sublabel: "从 VPD 文件加载静态姿势" },
```

完整的 items 数组变为：

```typescript
items: [
    { kind: "action", label: `当前: ${inst.vmdName || "无"}`, icon: "info", target: "", sublabel: undefined },
    { kind: "divider", label: "", icon: "", target: "" },
    { kind: "folder", label: "更换动作", icon: "music", target: `detail:motion:browse:${id}`, sublabel: "从动作库选择" },
    { kind: "action", label: "加载姿势 (VPD)", icon: "user", target: `detail:motion:pose:${id}`, sublabel: "从 VPD 文件加载静态姿势" },
    { kind: "action", label: inst.mmdModel ? (inst.vmdData ? "暂停动作" : "—") : "—", icon: "pause-circle", target: `detail:motion:pause:${id}`, sublabel: inst.vmdData ? "暂停/继续" : "无动作" },
    { kind: "action", label: "重置动作", icon: "rotate-ccw", target: `detail:motion:reset:${id}`, sublabel: "恢复初始姿势" },
    { kind: "divider", label: "", icon: "", target: "" },
    { kind: "action", label: `循环: ${inst.vmdData ? (autoLoop ? "开" : "关") : "—"}`, icon: "repeat", target: `detail:motion:loop:${id}`, sublabel: inst.vmdData ? "切换自动循环" : "加载动作后可用" },
],
```

- [ ] **Step 2: 在 `onItemClick` 的 `case "motion"` switch 中添加 `pose` 处理**

在 `case "reset"` 之后、`case "loop"` 之前添加：

```typescript
case "pose":
    (async () => {
        try {
            const path = await SelectVPDPose();
            if (!path) { setStatus("✗ 未选择文件", false); return; }
            await loadVPDPose(path, id);
            modelStack?.reRender();
        } catch (err: any) {
            setStatus("✗ " + (err.message || err), false);
        }
    })();
    break;
```

需要添加 `SelectVPDPose` 的 import：

```typescript
import { SelectVPDPose } from "../wailsjs/go/main/App";
```

- [ ] **Step 3: 添加 hover hint**

在 `hints` 对象中添加：

```typescript
"detail:motion:pose": "从 VPD 文件加载静态姿势",
```

- [ ] **Step 4: 构建验证**

```bash
cd MikuMikuAR/frontend && npx vite build 2>&1
```

---

### Task 6: 集成测试与边界情况

- [ ] **Step 1: 手动测试步骤**

1. 加载一个 PMX 模型到场景
2. 打开模型详情 → 动作绑定
3. 点击"加载姿势 (VPD)"
4. 选择一个 VPD 文件
5. 确认模型切换到该姿势，状态栏显示 `✓ 姿势: xxx.vpd`
6. 点击"重置动作"确认姿势被清除，模型回到 T 姿势
7. 加载一个普通 VMD → 确认 VMD 正常播放
8. 再加载一个 VPD → 确认姿势替换了 VMD 动画

- [ ] **Step 2: 处理空 VPD / 格式错误**

`loadVPDFromBuffer` 对无骨骼的 VPD 返回空 buffer（只有头部 + 0 帧），VMD pipeline 会正常加载但无效果，此时应提示用户。

- [ ] **Step 3: 处理编码错误**

VPD 文件可能包含无法转换到 Shift-JIS 的骨骼名。`encodeVPDBoneName` 已有 UTF-8 fallback。如果骨骼名含扩展字符，VMD 可能不匹配实际骨骼 — 这是 VPD/MMD 生态的固有兼容性问题，当前不做额外处理。

---

## 实现顺序

1. Task 1（格式确认） → Task 2（解析器） → Task 3（Go binding）→ Task 4（scene.ts）→ Task 5（UI）
2. 每个 Task 完成后立即 `vite build` 验证
3. 全部完成后全流程手动测试

## 回滚策略

每个 Task 改完后 `git add -A && git commit -m "wip: vpd task N"`。任一 Task 构建失败立即回滚该 Task 并排查。
