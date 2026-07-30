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
uniform float fresnelAlphaInfluence;  // Fresnel 对 alpha 的影响（默认 0.5）
uniform float foamOpacity;           // 泡沫独立透明度（默认 0.8）
uniform float uFoamNoiseStrength;    // 泡沫边缘噪声扰动强度（0=平滑阈值，默认 0.3）
uniform vec3 waterFogColor;          // 水面雾色（默认灰蓝色，模拟大气雾效果）
uniform float waterFogStart;         // 水面雾起始距离（从此距离开始混入雾色，默认 50）
uniform float waterFogEnd;           // 水面雾终止距离（到此距离完全混入雾色，默认 300）
uniform float waterFogOpacityInfluence; // 雾对透明度的影响（默认 0，即只混颜色）

// ======== 水下雾（与 scene.fog 同源；ShaderMaterial 不参与 Babylon fog，由 TS 手动注入）========
// 水下视角看水面：水面铺满视野，远处水面顶点距相机 depth 大 → 应褪入雾色，
// 与地面/角色用同一套 fog 参数（start=无雾阈值, end=满雾阈值），视觉统一。
uniform float uUnderwater;          // 0=关闭, 1=水下
uniform vec3 uUnderwaterFogColor;   // 水下雾色（联动天空底色）
uniform float uUnderwaterFogStart;  // 无雾阈值（距相机 ≤ 此值无雾）
uniform float uUnderwaterFogEnd;    // 满雾阈值（距相机 ≥ 此值满雾）

// ======== ADR-115 P1: 高频法线扰动层 + Sun Glitter ========
uniform sampler2D uDetailNormalTex;   // 程序化生成的法线细节纹理
uniform float uDetailNormalStrength;  // 细节法线整体强度（默认 0.3，0=关闭零回归）
uniform float uDetailNormalTiling1;   // 第一层平铺（默认 0.1）
uniform float uDetailNormalTiling2;   // 第二层平铺（默认 0.3）
// ADR-115 P2: 法线滚动速度倍率（由 TS 端基于 WAVE_SPEED/WAVE_FREQ 动态计算，驱动 wavePhase→UV 滚动）
uniform float uDetailNormalSpeed1;
uniform float uDetailNormalSpeed2;
uniform float uGlintStrength;         // Sun Glitter 闪烁强度（默认 0，0=关闭）
uniform float uGlintPower;            // 高光锐利度（默认 96）
uniform float uGlintScale;            // 噪声颗粒大小（默认 80.0）
uniform float uGlintSpeed;            // 闪烁动画速度（默认 2.0）

// ======== ADR-115 P5: 低频滚动法线层（大尺度滚动光带）========
uniform float uLowFreqNormalTiling;   // 低频法线平铺（默认 0.04，格 ≈25 单位）
uniform float uLowFreqNormalStrength; // 低频法线强度（默认 0.15，0=关闭零回归）
uniform float uLowFreqNormalSpeed;    // 低频法线滚动速度（默认 0.05）

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
uniform vec2 uCausticOffset;   // 焦散 UV 偏移（每帧由 causticsController 推 uOffset/vOffset，联动 causticScrollX/Y）

uniform vec4 uRipplePosRad[256];
uniform vec4 uRippleStrSpdLife[256];
uniform int uRippleCount;

float calcRipple(vec3 worldPos, vec3 center, float radius, float strength, float speed, float life, float maxLife) {
    vec2 delta = worldPos.xz - center.xz;
    float dist = length(delta);
    if (life <= 0.0 || maxLife <= 0.0) return 0.0;
    float t = clamp((maxLife - life) / maxLife, 0.0, 1.0);
    float endRadius = radius * max(1.0, speed);
    float expandingRadius = mix(radius, endRadius, t);
    if (dist > expandingRadius) return 0.0;
    float phase = (maxLife - life) * speed;
    float rings = 1.0;
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
uniform float planarReflectionBlend;
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

    // 相机相对坐标：所有纹理采样共用，避免远离原点时 float 精度丢失导致高频波纹消失
    vec2 camXZ = vWorldPos.xz - cameraPosition.xz;

    // 双层法线采样：UV 沿风向滚动，速度由 TS 端基于 WAVE_SPEED/WAVE_FREQ 动态计算
    // 大尺度层（tiling 小）滚动更快，细尺度层（tiling 大）稍慢，符合真实水面
    // 用相机相对坐标（同焦散），避免远离原点时 float 精度丢失导致高频波纹消失
    vec2 wind = uDetailWindDir;
    vec2 nUV1 = camXZ * uDetailNormalTiling1 + wind * wavePhase * uDetailNormalSpeed1;
    vec2 nUV2 = camXZ * uDetailNormalTiling2 - wind * wavePhase * uDetailNormalSpeed2; // 反向产生交错感
    // 纹理编码：R=世界X, G=世界Z, B=世界Y(上)
    vec3 n1 = texture2D(uDetailNormalTex, nUV1).rgb * 2.0 - 1.0;
    vec3 n2 = texture2D(uDetailNormalTex, nUV2).rgb * 2.0 - 1.0;
    // ADR-115 P5: 低频滚动法线层 — 大尺度滚动光带（格 ≈25 单位）
    vec2 nUV3 = camXZ * uLowFreqNormalTiling + wind * wavePhase * uLowFreqNormalSpeed;
    vec3 n3 = texture2D(uDetailNormalTex, nUV3).rgb * 2.0 - 1.0;
    vec3 detailNormal = normalize(n1 + n2 * 0.5 + n3 * uLowFreqNormalStrength);

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
            reflection = mix(cubemapRefl, planarRefl, planarReflectionBlend);
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
    // 泡沫边缘噪声扰动：用法线纹理 R 通道打破平滑阈值边缘，产生破碎感
    // uFoamNoiseStrength=0 时 foamNoise=0.5，foam 不变（零回归）
    float foamNoise = texture2D(uDetailNormalTex, camXZ * 0.1 + wavePhase * 0.02).r;
    foam = clamp(foam + (foamNoise - 0.5) * uFoamNoiseStrength, 0.0, 1.0);
    // 次级泡沫：波高略低于主阈值时也有微量泡沫，模拟波浪外围细小气泡
    float secondaryFoam = smoothstep(foamEnd * 0.7, foamEnd * 0.9, foamH) * 0.3;
    foam = max(foam, secondaryFoam);
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

    // 低太阳角度反射压制：太阳接近地平线时，反射方向朝地平线，
    // cubemap 地平线因大气散射极亮 → 水面泛白。用 sun elevation 压制反射强度
    float sunElev = max(normalize(lightDir).y, 0.0);
    float reflDampen = mix(0.4, 1.0, sunElev);

    // 天空-水面颜色联动：reflection 也朝天空色偏移，让"天空色联动"真正可见
    vec3 reflected = reflection * foamDamp;
    reflected = mix(reflected, uSkyBlendColor * 0.6, uSkyColorBlend);
    reflected *= reflDampen;

    // ======== 波高驱动水色调制 + 焦散：在反射混合之前应用 ========
    // 这样图案 baked 进 base 水色，Fresnel 高时反射虽主导但 base 仍带图案
    // 不受相机朝向影响（解决转180°波纹消失的问题）
    float waveDisp = vHeight - waterLevel;
    float waveNorm = clamp(waveDisp / max(waveHeight, 0.1), -1.0, 1.0);
    float waveBright = 1.0 + waveNorm * (0.1 + 0.15 * waveHeight);
    base *= waveBright;

    // ======== 焦散驱动表面法线扰动 + 亮度叠加 ========
    // 参考设计中，水面波纹就是焦散图案本身——焦散直接驱动表面起伏。
    // 当前架构把"几何扰动"(detail normal)和"光照图案"(caustic)拆成独立系统，
    // 导致焦散只是亮度叠加，不参与表面视觉起伏。
    // 修复：用焦散纹理的梯度作为额外法线偏移，让焦散亮纹同时产生可见的表面涟漪。

    // 层1：主焦散（scale 0.15 = CAUSTIC_WORLD_SCALE，cell ≈ 6.7 单位）
    // ✦ 此 0.15 与 env-caustics.ts 的 CAUSTIC_WORLD_SCALE 单源对齐：地面焦散 uScale 由它派生，
    //   改此处必须同步改 CAUSTIC_WORLD_SCALE，否则地水焦散尺度再次错配。
    // 用相机相对坐标（camXZ 已在 detail normal 段定义），精度稳定。
    // UV 偏移由 uCausticOffset 提供（causticsController 每帧推进纹理 uOffset/vOffset，
    // 联动用户参数 causticScrollX/Y），让主焦散层持续滚动而非静止。
    vec2 cuv1 = camXZ * 0.15 + uCausticOffset;
    float c1 = texture2D(uCausticTex, cuv1).r;

    // 层2：次焦散（2x scale + 旋转30° + 反向慢速滚动，与层1干涉）
    vec2 cuv2 = vec2(
        camXZ.x * 0.866 - camXZ.y * 0.5,
        camXZ.x * 0.5 + camXZ.y * 0.866
    ) * 0.3;
    cuv2 += vec2(-time * 0.03, time * 0.02) + uCausticOffset * -0.6;
    float c2 = texture2D(uCausticTex, cuv2).r;

    float caustic = c1 * 0.6 + c2 * 0.4;

    // 焦散梯度 → 法线扰动：采样相邻像素计算 dcdx/dcdy
    float eps = 0.02; // 稍大步长，平滑梯度（原 0.005 在 256px 纹理上噪声大）
    float cx1 = texture2D(uCausticTex, cuv1 + vec2(eps, 0)).r;
    float cy1 = texture2D(uCausticTex, cuv1 + vec2(0, eps)).r;
    float dcdx = (cx1 - c1) / eps;
    float dcdy = (cy1 - c1) / eps;
    // 将梯度转为法线偏移（强度由 causticIntensity 控制，0.5x 让正常视角也可见涟漪）
    vec3 causticNormalOffset = vec3(dcdx, 1.0, dcdy) * uCausticIntensity * 0.5;
    normal = normalize(normal + causticNormalOffset.xyz);

    // 焦散亮度叠加（加法，作为光斑，强度提升到正常视角可见）
    float causticBright = smoothstep(0.3, 0.85, caustic);
    base += causticBright * uCausticIntensity * 0.8;

    // 反射受泡沫衰减：泡沫区反射减弱；整体乘曝光因子联动日照明暗
    vec3 color = mix(base, reflected, fresnel) * lightExposure;

    float diff = max(dot(normal, normalize(lightDir)), 0.0);
    // 太阳直接光照项 × 强度：让迎光面随太阳亮度变化（已含强度，不再额外乘曝光，避免重复放大）
    color += diff * lightColor * diffuseStrength * max(lightIntensity * 1.2, 0.05);
    color += ambientIntensity * finalWaterColor * ambientStrength;

    // ======== ADR-115 P3: Sun Glitter（法线微扰驱动高光跳跃）========
    // 旧版：hash 调制固定高光的亮度 → 高光位置不动，亮度闪烁，视觉假
    // 新版：用细节法线微扰反射方向 → 高光位置随波跳动，真正"粼粼"感
    // 仅 uGlintStrength > 0 时生效（零回归）
    if (uGlintStrength > 0.0) {
        // n1 已在上面计算，是第一层法线纹理采样结果
        // 用法线微扰反射向量：局部倾斜导致高光位置偏移
        vec3 glintReflect = reflect(-viewDir, normalize(normal + n1 * uDetailNormalStrength * 0.8));
        // hash 噪声决定每个 fragment 的闪烁时刻（不是亮度，而是"是否闪烁"的概率）
        // ADR-115 二轮增强：glitterUV 叠加 vWaveOffset，让闪烁点随波浪斜率漂移，
        // 避免 hash 格子固定在世界坐标上导致"水面动但星点不动"的视觉假
        vec2 glitterUV = (vWorldPos.xz + vWaveOffset * 50.0) * uGlintScale + time * uGlintSpeed;
        float spark = hash12(floor(glitterUV));
        // 窄域 specular：微扰后 reflectDir 产生随机偏移的高光
        float spec = pow(max(dot(glintReflect, normalize(lightDir)), 0.0), uGlintPower);
        // 阈值化：只保留超过概率阈值的高光，其余丢弃（制造"星点"感而非整体泛光）
        // 阈值 0.7→0.82：保留 18% 像素（更稀疏、更亮的"波光"），配合 uGlintStrength 提升到 0.4 默认
        // 光强权重改写：原 *lightIntensity 让夕阳/夜晚 glint 消失；现 0.3~1.0 区间保底 30%，兼顾白天峰值
        float glintWeight = 0.3 + 0.7 * lightIntensity;
        float glitter = step(0.82, spark) * spec * uGlintStrength * glintWeight;
        color += lightColor * glitter;
    }

    // 泡沫混合（foam 已在上方计算）
    color = mix(color, foamColor, foam * foamIntensity);

    float rippleSum = 0.0;
    for (int i = 0; i < 1024; i++) {
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

    float depth = length(vWorldPos - cameraPosition);
    float waterFog = smoothstep(waterFogStart, waterFogEnd, depth);
    color = mix(color, finalFogColor * lightExposure, waterFog);

    // ======== ADR-115 P3: 地平线淡出 ========
    // uHorizonFade=0 时 horizonFade=1，完全不混合（零回归）
    float radialDist = length(vWorldPos.xz - cameraPosition.xz);
    float horizonFactor = 1.0 - smoothstep(uHorizonStart, uHorizonEnd, radialDist);
    float horizonMix = (1.0 - horizonFactor) * uHorizonFade;
    color = mix(color, uHorizonColor, horizonMix);

    // ======== 水下雾：让水面也参与 scene.fog 同套参数 ========
    // depth = 相机到水面顶点距离（上方 waterFog 同变量）。公式与 Babylon FOGMODE_LINEAR 一致：
    // depth ≤ start 无雾, depth ≥ end 满雾。水下视角远处水面 depth 大 → 褪入雾色，
    // 与地面/角色统一。乘 lightExposure 保证亮度与水面其余着色一致。
    if (uUnderwater > 0.5) {
        float uwFog = clamp((uUnderwaterFogEnd - depth) / (uUnderwaterFogEnd - uUnderwaterFogStart), 0.0, 1.0);
        color = mix(color, uUnderwaterFogColor * lightExposure, 1.0 - uwFog);
    }

    float alpha = mix(waterTransparency, 1.0, fresnel * fresnelAlphaInfluence + foam * foamIntensity * foamOpacity);
    alpha = mix(alpha, 1.0, waterFog * waterFogOpacityInfluence);
    // 地平线淡出时 alpha 渐增到 1（远处不透明，融入天空）
    alpha = mix(alpha, 1.0, horizonMix);
    alpha = clamp(alpha, 0.0, 1.0);

    // 柔和色调映射：防止高光过曝发白（Reinhard 变体，仅压缩 >1.0 区域）
    color = color / (1.0 + color);

    gl_FragColor = vec4(color, alpha);
}
