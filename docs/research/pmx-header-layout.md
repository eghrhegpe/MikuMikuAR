# PMX 二进制 Header 布局

> 从 research-notes.txt 提取整理。PMX 模型的二进制 header 结构，用于快速提取元数据。

## Header 布局

PMX 是小端二进制格式，header 结构如下：

```
offset  size  content
0x00    4     "PMX " 签名（4字节 ASCII）
0x04    4     版本号（float32，2.0 / 2.1）
0x08    1     flag 计数（通常 1）
0x09    1+    flags[0] = encoding (0=UTF-16LE, 1=UTF-8)  ← 关键
              之后是各表偏移信息...
```

## 四段文本提取

在全局信息区、顶点表之前，按顺序排列 **4 段 text**：

1. **模型名（本地）** — 日文/中文原名
2. **模型名（通用）** — 英文/罗马音
3. **模型说明/描述（本地）** — 作者常塞 credit、使用条件
4. **模型说明/描述（通用）** — 英文版说明

第③④段就是作者放使用说明和 credit 的地方，常含 AviUtl 注释风格的内容。

### 编码处理

根据 `flags[0]` 判断：

- `0` → **UTF-16LE**：Windows 上直接 cast，Unix 侧要转 UTF-8
- `1` → **UTF-8**：直接读

## 实现建议

**Rust 侧只读 header 前 1KB：**

```
File::open → take(1024) → 读 4 段 text 就停
```

**不需要全量解析器**（不需要 MikuMikuFormats 那么重）。

建索引库时顺手记录到 `meta.json`：

```json
{
  "name": "初音ミク",
  "name_en": "Hatsune Miku",
  "comment": "使用条件: 改変OK, クレジット不要",
  "comment_en": "Free to use, credit not required",
  "vertex_count": 12345,
  "bone_count": 60,
  "rigid_count": 42
}
```

库 UI 就能直接搜索/筛/显示作者说明。
