import re

with open(r"C:\Users\zhujieling11\MikuMikuAR\MikuMikuAR\frontend\src\scene\scene-env-clouds.ts", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add out vec4 fragColor; before void main(){ in fragment shader
old = '    return (1.0 - gg) / (4.0 * 3.14159 * pow(1.0 + gg - 2.0 * g * ct, 1.5));n}n\nvoid main(){\n    vec3 ro = cameraPosition;'
new = '    return (1.0 - gg) / (4.0 * 3.14159 * pow(1.0 + gg - 2.0 * g * ct, 1.5));n}n\nout vec4 fragColor;\nvoid main(){\n    vec3 ro = cameraPosition;'
if old in content:
    content = content.replace(old, new, 1)
    print("  [+] Added out vec4 fragColor")
else:
    print("  [!] Could not find phase->main bridge (trying alternate)")
    # Try alternate: just find last } before void main(){ in the file
    # Actually the fragment main is unique due to "vec3 ro = cameraPosition"
    idx = content.rfind('void main(){n    vec3 ro = cameraPosition;')
    if idx > 0:
        # Insert out vec4 fragColor; before void main(){
        content = content[:idx] + 'out vec4 fragColor;\n' + content[idx:]
        print("  [+] Added out vec4 fragColor (alternate method)")

# 2. Replace gl_FragColor = with fragColor =
count1 = content.count('gl_FragColor =')
content = content.replace('gl_FragColor =', 'fragColor =')
print(f"  [+] Replaced gl_FragColor = -> fragColor = ({count1} occurrences)")

# 3. Replace gl_FragColor.a with fragColor.a
count2 = content.count('gl_FragColor.a')
content = content.replace('gl_FragColor.a', 'fragColor.a')
print(f"  [+] Replaced gl_FragColor.a -> fragColor.a ({count2} occurrences)")

with open(r"C:\Users\zhujieling11\MikuMikuAR\MikuMikuAR\frontend\src\scene\scene-env-clouds.ts", "w", encoding="utf-8") as f:
    f.write(content)

print("nDone.")
