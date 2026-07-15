precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform float waveHeight;
uniform float wavePhase;
uniform int uWaterFlip;

// Gerstner 波参数
// WAVE_DIR 由外部 uniform uWindDir[4] 驱动（风向联动），在 createWater 时计算并传入
const int WAVE_COUNT = 4;
uniform vec2 uWindDir[4];
const float WAVE_FREQ[4] = float[4](0.15, 0.2, 0.25, 0.3);
const float WAVE_AMP[4] = float[4](0.3, 0.25, 0.2, 0.15);
const float WAVE_SPEED[4] = float[4](0.7, 0.9, 0.5, 1.2);

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
        float a = WAVE_AMP[i] * waveHeight;
        float th = f * dot(dir, p.xz) + WAVE_SPEED[i] * wavePhase;
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
