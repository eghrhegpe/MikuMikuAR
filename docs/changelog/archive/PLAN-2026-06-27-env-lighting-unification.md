# 环境光照统一方案

## 问题

天空视觉与光照完全解耦：
- 纯色/程序化天空 → 只改背景色，不影响模型照明
- 灯光面板独立控制 hemiLight + dirLight
- 用户调出夕阳红天空但模型仍被白光照射，无法做出真实的夕阳/夜景

## 方案：2（程序化联动）+ 3（统一入口）组合

### 核心公式（skyColor → 灯光参数）

```
输入: skyColor (Linear RGB), sunAngle (度, -15~90)
输出: dirLight.diffuse, dirDirection, hemiIntensity, dirIntensity, exposure
```

#### 1. 亮度推算

```typescript
const L = 0.299 * sky.r + 0.587 * sky.g + 0.114 * sky.b;
const dirIntensity = Math.max(L * 1.2, 0.15);
const hemiIntensity = 1.0 - dirIntensity * 0.5; // 天越暗 hemi 权重越高
```

#### 2. 色温推算（skyColor → dirDiffuse）

```typescript
const dirDiffuse = {
    r: Math.max(sky.r * 0.3 + 0.7, 0.2),
    g: Math.max(sky.g * 0.3 + 0.7, 0.2),
    b: Math.max(sky.b * 0.3 + 0.5, 0.2),
};
```

#### 3. 太阳角度 → 方向

```typescript
const theta = sunAngle * Math.PI / 180;
const azimuth = -45 * Math.PI / 180; // 固定东南方向
dirDirection = (cos(azimuth)*cos(theta), sin(theta), sin(azimuth)*cos(theta))
```

#### 4. 场景预设值矩阵

| 预设 | 天色 | 太阳角 | dirDiffuse | dirIntensity | hemiIntensity | exposure | toneMapping |
|------|------|--------|-----------|-------------|--------------|---------|-------------|
| 正午 | (0.53,0.71,0.91) | 75° | (1,0.98,0.95) | 1.0 | 0.4 | 1.0 | ACES |
| 夕阳 | (0.9,0.45,0.2) | 15° | (1,0.75,0.5) | 0.8 | 0.6 | 0.7 | Reinhard |
| 夜景 | (0.05,0.05,0.15) | -15° | (0.2,0.2,0.35) | 0.15 | 0.9 | 0.4 | Neutral |
| 阴天 | (0.4,0.4,0.45) | 45° | (0.7,0.7,0.75) | 0.3 | 1.0 | 0.8 | ACES |

### UI 架构

```
环境面板（新入口，合并天空/灯光/渲染三处）
├─ 模式切换: 预设 / 程序化
│
├─ 预设模式:
│  ├─ 正午 / 夕阳 / 夜景 / 阴天
│  └─ 选择后一次性设置: envState + lightState + renderState
│
└─ 程序化模式:
   ├─ 天空色（色盘/RGB 滑块）
   ├─ 太阳角度（-15~90 滑块）
   ├─ 自动联动 toggle ✅（默认开）
   │   └─ 开: 天空色+角度变化自动推算光照参数
   │   └─ 关: 只改天色不改光（兼容当前行为）
   └─ 曝光/toneMapping（独立控制）
```

### 实现步骤

1. 新建 `src/env-lighting.ts` — 推算公式纯函数 + 预设数据表
2. 修改 `src/scene.ts` — `setEnvState` 增加自动联动逻辑
3. 新建 `src/scene-menu.ts` 环境面板 UI（替代现在的发散入口）
4. 保留旧面板作为兼容（用户可切回独立控制）
