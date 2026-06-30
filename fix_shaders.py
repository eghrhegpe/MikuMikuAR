with open(r'C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene/scene-env-clouds.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Fix VERT_SRC: remove #version, in->attribute, out->varying, fix gl_Position typo
in_vert = False
for i, line in enumerate(lines):
    if 'const VERT_SRC' in line:
        in_vert = True
    if in_vert:
        if '#version 300 es' in line:
            lines[i] = ''
            print(f'  [+] Removed #version from VERT_SRC (line {i+1})')
        if 'in vec3 position;' in line:
            lines[i] = line.replace('in vec3 position;', 'attribute vec3 position;')
            print(f'  [+] VERT line {i+1}: in->attribute')
        if 'out vec3 vWorldPos;' in line:
            lines[i] = line.replace('out vec3 vWorldPos;', 'varying vec3 vWorldPos;')
            print(f'  [+] VERT line {i+1}: out->varying (vWorldPos)')
        if 'out float vDistFromCenter;' in line:
            lines[i] = line.replace('out float vDistFromCenter;', 'varying float vDistFromCenter;')
            print(f'  [+] VERT line {i+1}: out->varying (vDistFromCenter)')
        if 'gl_Position' in line and 'gl_Position' not in line:
            lines[i] = line.replace('gl_Position', 'gl_Position')
            print(f'  [+] Fixed gl_Position typo (line {i+1})')
        # Detect end of VERT_SRC template literal
        if line.strip() == '`);' and i > 0:
            # Check this is the closing of VERT_SRC (not FRAG_SRC)
            # Simple heuristic: if we saw 'const VERT_SRC' earlier, this ends it
            in_vert = False

with open(r'C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene/scene-env-clouds.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Done.')
