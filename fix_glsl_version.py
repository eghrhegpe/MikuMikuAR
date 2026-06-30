with open(r'C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene/scene-env-clouds.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix VERT_SRC: ensure #version 300 es is the very first chars of the template string
# Current: const VERT_SRC = `\n#version 300 es\n...`
# Goal:    const VERT_SRC = `#version 300 es\nprecision...\n...`

old_vert = r"const VERT_SRC = `\n#version 300 es"
new_vert = "const VERT_SRC = `#version 300 es"
if old_vert in content:
    content = content.replace(old_vert, new_vert, 1)
    print("  [+] VERT_SRC: removed leading newline before #version")
else:
    print("  [?] VERT_SRC #version pattern not found (may already be fixed or different)")

# Fix FRAG_SRC: add #version 300 es as first line, convert to GLSL 3.0 syntax
# Current FRAG_SRC starts with: `\nprecision highp float;\nvarying vec3...`
# Need to: remove leading newline, add #version 300 es, change varying->in, gl_FragColor->fragColor+out

old_frag_start = r"const FRAG_SRC = `\nprecision highp float;"
new_frag_start = "const FRAG_SRC = `#version 300 es\nprecision highp float;"
if old_frag_start in content:
    content = content.replace(old_frag_start, new_frag_start, 1)
    print("  [+] FRAG_SRC: added #version 300 es, removed leading newline")
else:
    print("  [?] FRAG_SRC start pattern not found")

# Now replace 'varying' with 'in' (for fragment shader inputs)
# But only inside FRAG_SRC. For safety, do global replace since VERT_SRC no longer has 'varying'
content = content.replace("varying vec3 vWorldPos;", "in vec3 vWorldPos;")
content = content.replace("varying float vDistFromCenter;", "in float vDistFromCenter;")
print("  [+] Replaced varying->in in fragment shader")

# Replace gl_FragColor with fragColor (need to add 'out vec4 fragColor;' before main)
# First, add 'out vec4 fragColor;' before 'void main(){'
old_main = "void main(){"
new_main = "out vec4 fragColor;\nvoid main(){"
# Only replace the one in FRAG_SRC (not in VERT_SRC). 
# The fragment main has 'vec3 ro = cameraPosition;' after it.
if "    vec3 ro = cameraPosition;" in content:
    # This is inside FRAG_SRC main(), so the preceding 'void main(){' is the fragment one
    # Do a targeted replace: find 'void main(){' followed by newline and '    vec3 ro'
    content = content.replace("void main(){\n    vec3 ro = cameraPosition;", "out vec4 fragColor;\nvoid main(){\n    vec3 ro = cameraPosition;", 1)
    print("  [+] Added 'out vec4 fragColor;' before fragment main()")
else:
    print("  [?] Fragment main() pattern not found")

# Replace gl_FragColor = with fragColor =
content = content.replace("gl_FragColor =", "fragColor =")
content = content.replace("gl_FragColor.a", "fragColor.a")
print("  [+] Replaced gl_FragColor->fragColor")

# Write back
with open(r'C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene/scene-env-clouds.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("\nDone. Now need to also add sampler3D support...")
