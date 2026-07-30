precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform float waveHeight;       // 全局振幅乘子（旧 uniform，保留，向后兼容）
uniform float bigWaveHeight;    // ADR-115 P4: 大波振幅缩放（Gerstner 层 0,1），默认 1.0
uniform float smallWaveHeight;  // ADR-115 P4: 小波振幅缩放（Gerstner 层 2,3），默认 1.0
uniform float wavePhase;
uniform int uWaterFlip;

// Gerstner 波参数
// WAVE_DIR 由外部 uniform uWindDir[4] 驱动（风向联动），在 createWater 时计算并传入
// uWindSpeed 调制波幅度：风速 0 时平静（0.3 倍），风速 10 时汹涌（1.8 倍）
const int WAVE_COUNT = 4;
uniform vec2 uWindDir[4];
uniform float uWindSpeed;
// ADR-115 二轮增强：色散关系开关。0=旧硬编码 WAVE_SPEED（零回归），1=物理色散 ω=sqrt(g·k)
// WAVE_FREQ 语义为空间频率 1/λ，故波数 k = 2π·f；色散 ω=sqrt(g·k) 使长波快、短波慢
uniform float uDispersionEnabled;
const float G = 9.8; // 重力加速度（色散关系用）
const float WAVE_FREQ[4] = float[4](0.07, 0.11, 0.25, 0.3); // ADR-115 P5: 层 0/1 拉长波长（42→90/57 单位），制造连绵涌浪
const float WAVE_AMP[4] = float[4](0.5, 0.4, 0.32, 0.25);
const float WAVE_SPEED[4] = float[4](0.7, 0.9, 0.5, 1.2); // 旧版硬编码 ω（uDispersionEnabled=0 时使用）

varying vec2 vUV;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vScreenCoord;
varying vec2 vWaveOffset;

void main() {
    vUV = uv;
    vec3 worldPos = (world * vec4(position, 1.0)).xyz;
    vec3 p = worldPos;
    vec3 n = vec3(0.0, 1.0, 0.0);
    vec2 waveOffset = vec2(0.0);

    for (int i = 0; i < WAVE_COUNT; i++) {
        vec2 dir = uWindDir[i];
        float f = WAVE_FREQ[i];
        // ADR-115 P4: 双层尺度拆分 — 层 0,1 大波组 / 层 2,3 小波组，再乘全局 waveHeight
        // 风速调制波幅度：0 级风时 0.3 倍（平静海面），10 级风时 1.8 倍（汹涌涌浪）
        float h = (i < 2) ? bigWaveHeight : smallWaveHeight;
        float windAmp = 0.3 + 0.15 * uWindSpeed;
        float a = WAVE_AMP[i] * h * waveHeight * windAmp;
        // 色散关系：uDispersionEnabled=0 用旧硬编码 ω（零回归），=1 用 ω=sqrt(g·k)
        float k = 2.0 * 3.14159265 * f;
        float omega = mix(WAVE_SPEED[i], sqrt(G * k), uDispersionEnabled);
        float th = f * dot(dir, p.xz) + omega * wavePhase;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
        // 波浪驱动的反射偏移：基于波浪斜率的实时偏移
        waveOffset += dir * f * a * s;
    }
    vWaveOffset = waveOffset * 0.01;

    vWorldPos = p;
    vec3 finalNormal = normalize(n);
    if (uWaterFlip == 1) {
        finalNormal = -finalNormal;
    }
    vNormal = finalNormal;
    vHeight = p.y;
    vec4 clipPos = viewProjection * vec4(p, 1.0);
    vScreenCoord = clipPos.xy / clipPos.w * 0.5 + 0.5;
    gl_Position = clipPos;
}
