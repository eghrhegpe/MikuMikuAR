precision highp float;
varying vec2 vUV;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vScreenCoord;
varying vec2 vWaveOffset;

uniform vec3 cameraPosition;
uniform vec3 waterColor;
uniform float waterTransparency;
uniform float waterLevel;
uniform float waveHeight;
uniform float time;
uniform float envIntensity;
uniform vec3 foamColor;
uniform float foamThreshold;
uniform float foamIntensity;
uniform vec3 lightDir;
uniform vec3 lightColor;
uniform float lightIntensity;   // 太阳平行光强度（dirLight.intensity），驱动水面随日照明暗
uniform float ambientIntensity;

// ======== 可调节的视觉参数（从硬编码提取）========
uniform float fresnelBias;      // Fresnel 偏移（默认 0.02）
uniform float fresnelPower;      // Fresnel 幂次（默认 3.0）
uniform float diffuseStrength;    // 漫反射强度（默认 0.15）
uniform float ambientStrength;    // 环境光强度系数（默认 0.15）
uniform float foamTransitionRange; // 泡沫过渡范围（默认 0.15）
uniform float rippleNormalStrength; // 涟漪法线影响强度（默认 0.15）
uniform float rippleGlintStrength; // 涟漪光泽强度（默认 0.25）
uniform vec3 causticColor1;     // 焦散颜色1（亮部，默认 vec3(1.0, 0.9, 0.6)）
uniform vec3 causticColor2;     // 焦散颜色2（暗部，默认 vec3(1.0, 1.0, 0.8)）
uniform float causticScrollX;   // 焦散UV滚动速度X（默认 0.10）
uniform float causticScrollY;   // 焦散UV滚动速度Y（默认 0.15）
uniform float fresnelAlphaInfluence;  // Fresnel 对 alpha 的影响（默认 0.5）
uniform float foamOpacity;           // 泡沫独立透明度（默认 0.8）
uniform vec3 waterFogColor;          // 水面雾色（默认灰蓝色，模拟大气雾效果）
uniform float waterFogDensity;       // 水面雾密度（深度感，默认 0.012）
uniform float waterFogOpacityInfluence; // 雾对透明度的影响（默认 0，即只混颜色）

// ======== ADR-115 P1: 高频法线扰动层 + Sun Glitter ========
uniform sampler2D uDetailNormalTex;   // 程序化生成的法线细节纹理
uniform float uDetailNormalStrength;  // 细节法线整体强度（默认 0.3，0=关闭零回归）
uniform float uDetailNormalTiling1;   // 第一层平铺（默认 0.1）
uniform float uDetailNormalTiling2;   // 第二层平铺（默认 0.3）
uniform float uDetailNormalSpeed1;    // 第一层滚动速度（默认 0.05）
uniform float uDetailNormalSpeed2;    // 第二层滚动速度（默认 -0.08）
uniform float uGlintStrength;         // Sun Glitter 闪烁强度（默认 0，0=关闭）
uniform float uGlintPower;            // 高光锐利度（默认 96）
uniform float uGlintScale;            // 噪声颗粒大小（默认 80.0）
uniform float uGlintSpeed;            // 闪烁动画速度（默认 2.0）

// ======== ADR-115 P3: 地平线淡出 + 天空-水面颜色联动 ========
uniform float uHorizonFade;           // 地平线淡出强度（0=关闭，1=完全淡出）
uniform float uHorizonStart;          // 淡出起始距离（TS端按 waterSize*0.7 计算）
uniform float uHorizonEnd;            // 淡出结束距离（TS端按 waterSize*0.95 计算）
uniform vec3 uHorizonColor;           // 地平线融合色（取自天空底部或雾色）
uniform vec3 uSkyBlendColor;          // 天空基准色（TS端从 skyColorBot 计算）
uniform float uSkyColorBlend;         // 天空-水色混合比例（0=自定义，1=跟随天空）

// 细节法线波浪联动：让法线纹理跟随 Gerstner 波浪方向+相位运动（不再静态平移）
uniform float wavePhase;              // 与 vert shader 共享的波浪相位
uniform vec2 uDetailWindDir;          // 主风向（归一化），驱动法线纹理滚动方向

uniform sampler2D uCausticTex;
uniform float uCausticIntensity;
uniform float uCausticSpeed;
uniform float uCausticScale;

uniform vec4 uRipplePosRad[256];
uniform vec4 uRippleStrSpdLife[256];
uniform int uRippleCount;

float calcRipple(vec3 worldPos, vec3 center, float radius, float strength, float speed, float life, float maxLife) {
    vec2 delta = worldPos.xz - center.xz;
    float dist = length(delta);
    float elapsed = maxLife - life;
    float expandingRadius = radius * (1.0 + elapsed * speed * 0.15);
    if (dist > expandingRadius || life <= 0.0 || maxLife <= 0.0) return 0.0;
    float phase = elapsed * speed * 1.0;
    float rings = 2.0;
    float wave = sin(dist * 6.28 * rings / expandingRadius - phase);
    float fade = exp(-dist / (expandingRadius * 0.8));
    float envelope = strength * (1.0 - dist / expandingRadius) * fade;
    float lifeFactor = clamp(life / maxLife, 0.0, 1.0);
    return wave * envelope * lifeFactor;
}

// ADR-115 P1: Sun Glitter 伪随机噪声
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

#ifdef ENV_TEXTURE
uniform samplerCube envTexture;
#endif

#ifdef PLANAR_REFLECTION
uniform sampler2D reflectionTexture;
uniform float planarReflectBlend;
#endif

void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 normal = normalize(vNormal);

    float facing = dot(viewDir, normal);
    if (facing < 0.0) {
        normal = -normal;
    }

    // ======== ADR-115 P1: 高频法线扰动层（波浪联动版）=====
    // Gerstner 去重：detail 启用时衰减 Gerstner 法线至 70%，让细节法线接管高频
    // uDetailNormalStrength == 0 时 gerstnerScale = 1.0，完全恢复 Gerstner 原貌（零回归）
    float gerstnerScale = uDetailNormalStrength > 0.0 ? 0.7 : 1.0;

    // 双层法线采样：UV 沿风向滚动，相位与 Gerstner 波浪同步
    // 滚动速度对齐大浪波峰速度（WAVE_SPEED/WAVE_FREQ ≈ 4~4.7 单位/秒），之前 1.5/0.8 慢了约 3 倍
    // 大尺度层（tiling 小）滚动更快，细尺度层（tiling 大）稍慢，符合真实水面
    vec2 wind = uDetailWindDir;
    vec2 nUV1 = vWorldPos.xz * uDetailNormalTiling1 + wind * wavePhase * 4.5;
    vec2 nUV2 = vWorldPos.xz * uDetailNormalTiling2 - wind * wavePhase * 2.5; // 反向产生交错感
    // 纹理编码：R=世界X, G=世界Z, B=世界Y(上)
    vec3 n1 = texture2D(uDetailNormalTex, nUV1).rgb * 2.0 - 1.0;
    vec3 n2 = texture2D(uDetailNormalTex, nUV2).rgb * 2.0 - 1.0;
    vec3 detailNormal = normalize(n1 + n2 * 0.5);

    normal = normalize(
        normal * gerstnerScale +
        vec3(detailNormal.x * uDetailNormalStrength, 1.0, detailNormal.y * uDetailNormalStrength)
    );

    vec3 reflectDir = reflect(-viewDir, normal);

    vec3 reflection = vec3(0.0);
    #ifdef ENV_TEXTURE
        vec3 cubemapRefl = textureCube(envTexture, reflectDir).rgb * envIntensity;
        reflection = cubemapRefl;
    #endif
    #ifdef PLANAR_REFLECTION
        // P2: 波浪 UV 偏移 — 用世界坐标 XZ + 波浪实时偏移，让反射随波浪晃动
        vec2 reflUV = vec2(vScreenCoord.x, 1.0 - vScreenCoord.y);
        reflUV += vWorldPos.xz * 0.003 + vWaveOffset;
        // 轻微模糊：手动 RT 无 mipmap 自动重建，5-tap 采样降低镜面锯齿（ADR-114 修复）
        vec2 blurOff = vec2(0.004, 0.0);
        vec3 planarRefl = (
            texture2D(reflectionTexture, reflUV).rgb +
            texture2D(reflectionTexture, reflUV + blurOff).rgb +
            texture2D(reflectionTexture, reflUV - blurOff).rgb +
            texture2D(reflectionTexture, reflUV + blurOff.yx).rgb +
            texture2D(reflectionTexture, reflUV - blurOff.yx).rgb
        ) * 0.2;
        #ifdef ENV_TEXTURE
            reflection = mix(cubemapRefl, planarRefl, planarReflectBlend);
        #else
            reflection = planarRefl;
        #endif
    #endif

    // P2: 泡沫区域反射衰减 — 提前计算 foam，用于压低反射
    float foamH = vHeight - waterLevel;
    // 泡沫阈值随波高动态缩放：高波时泡沫只集中在波峰尖端，避免大面积白色条纹
    float waveHeightScale = 1.0 + waveHeight * 1.0;
    float foamStart = foamThreshold * waveHeightScale;
    float foamEnd = foamStart + foamTransitionRange * (1.0 + waveHeight * 0.5);
    float foam = smoothstep(foamStart, foamEnd, foamH);
    foam = clamp(foam, 0.0, 1.0);
    float foamDamp = 1.0 - foam * foamIntensity;

    float fresnel = fresnelBias + (1.0 - fresnelBias) * pow(1.0 - max(dot(viewDir, normal), 0.0), fresnelPower);

    // ======== ADR-115 P3: 天空-水面颜色联动 ========
    // uSkyColorBlend=0 时 finalWaterColor=waterColor（零回归）
    vec3 finalWaterColor = mix(waterColor, uSkyBlendColor, uSkyColorBlend);
    vec3 finalFogColor = mix(waterFogColor, uSkyBlendColor * 0.8, uSkyColorBlend);

    vec3 base = finalWaterColor;

    // ======== 光照联动：水面整体随太阳/环境明暗 ========
    // 反射（占主导）与环境光都应按日照变暗；sun=0 时水面显著变暗而非不变
    float lightExposure = clamp(lightIntensity * 1.3 + ambientIntensity * 0.5 + 0.06, 0.04, 1.8);

    // 天空-水面颜色联动：reflection 也朝天空色偏移，让"天空色联动"真正可见
    vec3 reflected = reflection * foamDamp;
    reflected = mix(reflected, uSkyBlendColor * (0.5 + lightIntensity), uSkyColorBlend);

    // 反射受泡沫衰减：泡沫区反射减弱；整体乘曝光因子联动日照明暗
    vec3 color = mix(base, reflected, fresnel) * lightExposure;

    float diff = max(dot(normal, normalize(lightDir)), 0.0);
    // 太阳直接光照项 × 强度：让迎光面随太阳亮度变化（已含强度，不再额外乘曝光，避免重复放大）
    color += diff * lightColor * diffuseStrength * max(lightIntensity * 1.2, 0.05);
    color += ambientIntensity * finalWaterColor * ambientStrength;

    // ======== ADR-115 P1: Sun Glitter（镜面闪烁高光）========
    // hash 噪声调制，制造"跳动"感；仅 uGlintStrength > 0 时生效（零回归）
    if (uGlintStrength > 0.0) {
        vec2 glitterUV = vWorldPos.xz * uGlintScale + time * uGlintSpeed;
        float noiseVal = hash12(floor(glitterUV));
        float noiseVal2 = hash12(floor(glitterUV * 3.7 + 13.0));
        float glitterNoise = mix(noiseVal, noiseVal2, 0.3);
        // 窄域 specular：reflectDir 已含细节法线扰动，自然产生波光
        float spec = pow(max(dot(reflectDir, normalize(lightDir)), 0.0), uGlintPower);
        // 乘以 diffuse 作为 mask：仅在迎光面闪烁；乘强度避免暗光下仍强闪
        float glitter = diff * spec * (0.6 + 0.8 * glitterNoise) * uGlintStrength * lightIntensity;
        color += lightColor * glitter;
    }

    // 泡沫混合（foam 已在上方计算）
    color = mix(color, foamColor, foam * foamIntensity);

    float rippleSum = 0.0;
    for (int i = 0; i < 256; i++) {
        if (i >= uRippleCount) break;
        vec4 pr = uRipplePosRad[i];
        vec4 ssl = uRippleStrSpdLife[i];
        if (pr.w <= 0.0 || ssl.z <= 0.0 || ssl.w <= 0.0) continue;
        float r = calcRipple(vWorldPos, pr.xyz, pr.w, ssl.x, ssl.y, ssl.z, ssl.w);
        rippleSum += r;
    }
    vec3 rippleN = vec3(rippleSum * rippleNormalStrength, 0.0, rippleSum * rippleNormalStrength);
    normal = normalize(normal + rippleN);
    float rippleGlint = max(0.0, rippleSum * rippleGlintStrength);
    color += vec3(rippleGlint);

    vec2 causticUV = vWorldPos.xz * uCausticScale + vec2(time * uCausticSpeed * causticScrollX, time * uCausticSpeed * causticScrollY);
    float caustic = texture2D(uCausticTex, causticUV).r;
    vec3 causticCol = mix(causticColor1, causticColor2, caustic);
    color += causticCol * caustic * uCausticIntensity;

    float depth = length(vWorldPos - cameraPosition);
    float waterFog = 1.0 - exp(-waterFogDensity * depth);
    color = mix(color, finalFogColor, waterFog);

    // ======== ADR-115 P3: 地平线淡出 ========
    // uHorizonFade=0 时 horizonFade=1，完全不混合（零回归）
    float radialDist = length(vWorldPos.xz - cameraPosition.xz);
    float horizonFactor = 1.0 - smoothstep(uHorizonStart, uHorizonEnd, radialDist);
    float horizonMix = (1.0 - horizonFactor) * uHorizonFade;
    color = mix(color, uHorizonColor, horizonMix);

    float alpha = mix(waterTransparency, 1.0, fresnel * fresnelAlphaInfluence + foam * foamIntensity * foamOpacity);
    alpha = mix(alpha, 1.0, waterFog * waterFogOpacityInfluence);
    // 地平线淡出时 alpha 渐增到 1（远处不透明，融入天空）
    alpha = mix(alpha, 1.0, horizonMix);
    alpha = clamp(alpha, 0.0, 1.0);

    // 柔和色调映射：防止高光过曝发白（Reinhard 变体，仅压缩 >1.0 区域）
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, alpha);
}
