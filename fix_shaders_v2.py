with open(r'C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene/scene-env-clouds.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# ========== 1. Rewrite VERT_SRC (GLSL 1.0) ==========
new_vert = """const VERT_SRC = `\
precision highp float;\
attribute vec3 position;\
uniform mat4 world;\
uniform mat4 worldViewProjection;\
uniform float sphereRadius;\
varying vec3 vWorldPos;\
varying float vDistFromCenter;\
void main(){\
    vec4 worldPos = world * vec4(position, 1.0);\
    vWorldPos = worldPos.xyz;\
    vDistFromCenter = length(worldPos.xz);\
    gl_Position = worldViewProjection * vec4(position, 1.0);\
}`;\
"""

# Find VERT_SRC start
vert_start = None
vert_end = None
for i, line in enumerate(lines):
    if 'const VERT_SRC' in line:
        vert_start = i
    if vert_start is not None and line.strip() == '`);' and i > vert_start:
        vert_end = i
        break

if vert_start is not None and vert_end is not None:
    # Remove the \ at end of new_vert (last two chars are \ and newline)
    new_vert_clean = new_vert.replace('\\', '')  # remove trailing backslashes from lines
    # Actually, let's just replace the whole block
    lines[vert_start:vert_end+1] = [new_vert]
    print(f'  [+] VERT_SRC rewritten (GLSL 1.0, lines {vert_start+1}-{vert_end+1})')
else:
    print(f'  [!] VERT_SRC not found (start={vert_start}, end={vert_end})')

# ========== 2. Rewrite FRAG_SRC (GLSL 1.0, performance optimized) ==========
new_frag = """const FRAG_SRC = `\
precision highp float;\
varying vec3 vWorldPos;\
varying float vDistFromCenter;\
uniform vec3 cameraPosition;\
uniform float time;\
uniform float cloudDensity;\
uniform vec3 windDirection;\
uniform float cloudBaseY;\
uniform float cloudTopY;\
uniform float cloudScale;\
uniform float cloudVisibility;\
uniform float brightness;\
uniform vec3 sceneLightDir;\
uniform vec3 sceneLightColor;\
uniform float sphereRadius;\
\
// ======== Constants ========\
#define CLOUD_LIGHT_ATTEN 0.15\
#define CLOUD_PHASE_G 0.8\
#define CLOUD_SCATTER_INTENSITY 0.5\
#define CLOUD_SIGMA_S_SCALE 0.08\
#define CLOUD_MAX_OPTICAL_DEPTH 5.0\
#define CLOUD_DENSITY_THRESHOLD 0.005\
#define CLOUD_LIGHT_STEPS 1\
#define CLOUD_MAX_STEPS 48\
#define CLOUD_THRESHOLD_FACTOR 0.65\
\
// Simplified noise (1 octave, no FBM loop)\
float hash(vec3 p) {\
    p = fract(p * 0.3183099 + 0.1);\
    p *= 17.0;\
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));\
}\
\
float noise3D(vec3 p) {\
    vec3 i = floor(p);\
    vec3 f = fract(p);\
    f = f * f * (3.0 - 2.0 * f);\
    return mix(\
        mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),\
            mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),\
        mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),\
            mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),\
        f.z\
    );\
}\
\
float getDensity(vec3 pos, float dScale, vec3 wind, float distFactor) {\
    float h = pos.y;\
    if (h < cloudBaseY || h > cloudTopY) return 0.0;\
    float hf = smoothstep(cloudBaseY, cloudBaseY + 15.0, h) * (1.0 - smoothstep(cloudTopY - 15.0, cloudTopY, h));\
    vec3 p = pos + wind * time * 0.3;\
    // Single octave, no FBM loop (performance)\
    float n = noise3D(p * 0.04 * cloudScale) * 0.7;\
    n = clamp(n, 0.0, 1.0);\
    float threshold = 1.0 - dScale * CLOUD_THRESHOLD_FACTOR;\
    threshold = clamp(threshold, 0.15, 0.95);\
    float t = (n - threshold) / (1.0 - threshold);\
    n = clamp(t * t, 0.0, 1.0);\
    n *= 1.5 * hf * distFactor;\
    return max(0.0, n);\
}\
\
float phase(float ct) {\
    float g = CLOUD_PHASE_G;\
    float gg = g * g;\
    return (1.0 - gg) / (4.0 * 3.14159 * pow(1.0 + gg - 2.0 * g * ct, 1.5));\
}\
\
void main(){}\
    vec3 ro = cameraPosition;\
    vec3 rd = normalize(vWorldPos - cameraPosition);\
    int steps = 48;\
    float distToCloud = abs(cloudBaseY - cameraPosition.y);\
    float stepMultiplier = clamp(distToCloud / 400.0, 0.33, 1.0);\
    steps = int(float(steps) * stepMultiplier);\
    if (steps < 8) steps = 8;\
    float maxDist = cloudVisibility;\
    float stepSize = maxDist / float(steps);\
    vec3 rp = ro;\
    float seed = dot(gl_FragCoord.xy, vec2(12.9898, 78.233));\
    float dither = fract(sin(seed) * 43758.5453) * stepSize;\
    rp += rd * dither;\
    float opticalDepth = 0.0;\
    float T = 1.0;\
    vec3 scatter = vec3(0.0);\
    float dist = 0.0;\
    vec3 wind = windDirection;\
    vec3 lightDir = normalize(-sceneLightDir);\
    for (int i = 0; i < CLOUD_MAX_STEPS; i++) {\
        if (i >= steps) break;\
        if (dist > maxDist) break;\
        float distRatio = clamp(dist / (maxDist * 0.3), 0.0, 1.0);\
        float dynamicStep = mix(stepSize * 0.5, stepSize * 1.5, distRatio * distRatio);\
        dynamicStep = clamp(dynamicStep, 1.5, 12.0);\
        rp += rd * dynamicStep;\
        dist += dynamicStep;\
        float distFactor = 1.0 - smoothstep(0.0, maxDist, dist * 0.8);\
        float d = getDensity(rp, cloudDensity, wind, distFactor);\
        if (d > CLOUD_DENSITY_THRESHOLD) {\
            opticalDepth += d * dynamicStep * 0.12;\
            T = exp(-opticalDepth);\
            // Single light step (performance)\
            vec3 lightPos = rp + lightDir * 4.0;\
            float ld = getDensity(lightPos, cloudDensity * 0.6, wind, distFactor);\
            float transmittance = exp(-ld * 4.0 * CLOUD_LIGHT_ATTEN);\
            float ct = dot(rd, -lightDir);\
            float ph = phase(ct);\
            vec3 sc = sceneLightColor * transmittance * ph * CLOUD_SCATTER_INTENSITY * brightness;\
            float sigma_s = d * CLOUD_SIGMA_S_SCALE;\
            scatter += sc * T * (1.0 - exp(-sigma_s * dynamicStep));\
        }\
        if (opticalDepth > CLOUD_MAX_OPTICAL_DEPTH) break;\
    }\
    float hg = clamp((rd.y + 0.4) / 0.9, 0.0, 1.0);\
    vec3 sky = mix(vec3(0.5, 0.65, 0.85), vec3(0.25, 0.45, 0.75), hg);\
    vec3 color = sky * T + scatter;\
    float horizonFade = 1.0 - smoothstep(sphereRadius * 0.85, sphereRadius, vDistFromCenter);\
    color *= horizonFade;\
    color = mix(color, vec3(1.0, 0.98, 0.95), smoothstep(0.7, 0.2, T));\
    float edgeIntensity = T * (1.0 - T) * 4.0;\
    edgeIntensity = clamp(edgeIntensity, 0.0, 1.0);\
    float backScatter = max(0.0, -dot(rd, normalize(sceneLightDir)));\
    float angleFactor = pow(backScatter, 1.5) * 1.5;\
    vec3 glowColor = mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.95, 0.8), edgeIntensity);\
    color += glowColor * edgeIntensity * angleFactor * 0.6;\
    gl_FragColor = vec4(color, clamp(1.0 - T, 0.0, 0.95) * horizonFade);\
    if (gl_FragColor.a < 0.05 || T > 0.95) discard;\
}\
`;\
"""

# Find FRAG_SRC start
frag_start = None
frag_end = None
for i, line in enumerate(lines):
    if 'const FRAG_SRC' in line:
        frag_start = i
    if frag_start is not None and line.strip() == '`);' and i > frag_start:
        frag_end = i
        break

if frag_start is not None and frag_end is not None:
    lines[frag_start:frag_end+1] = [new_frag]
    print(f'  [+] FRAG_SRC rewritten (GLSL 1.0, optimized, lines {frag_start+1}-{frag_end+1})')
else:
    print(f'  [!] FRAG_SRC not found (start={frag_start}, end={frag_end})')

# Write back
with open(r'C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene/scene-env-clouds.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print('\nDone. Shaders rewritten to GLSL 1.0 + performance optimized.')
