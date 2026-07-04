#!/usr/bin/env python3
"""Pure-stdlib PNG writer + 三张 512x512 程序化地面纹理生成器
无需任何外部依赖（仅用 zlib + struct）
输出：frontend/public/textures/grass.png, stone.png, sand.png
"""

import struct, zlib, random, math, os

W = 512
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'frontend', 'public', 'textures'))
os.makedirs(OUT, exist_ok=True)

# ── PNG writer ───────────────────────────────────────────────────────
def write_png(path, pixels):
    """pixels: list[list[(R,G,B)]], 尺寸 W x H，值 0~255"""
    h = len(pixels)
    w = len(pixels[0]) if h else 0
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    raw = b''
    for row in pixels:
        raw += b'\x00'  # filter: none
        for r, g, b in row:
            raw += bytes([r, g, b])
    idat = chunk(b'IDAT', zlib.compress(raw, 6))
    iend = chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)

# ── Perlin noise (value noise, 4 octaves) ─────────────────────────
def perlin(w, h, rng, scale=8):
    freqs = [1, 2, 4, 8]
    amps  = [1.0, 0.5, 0.25, 0.125]
    def mk_grad(gw, gh):
        return [[rng.random() * math.pi * 2 for _ in range(gw)] for _ in range(gh)]
    grid = [[0.0]*w for _ in range(h)]
    for freq, amp in zip(freqs, amps):
        gw = int(w / scale * freq) + 2
        gh = int(h / scale * freq) + 2
        grad = mk_grad(gw, gh)
        for y in range(h):
            for x in range(w):
                nx = (x / w) * scale * freq
                ny = (y / h) * scale * freq
                ix, iy = int(nx), int(ny)
                fx, fy = nx - ix, ny - iy
                def d(gx, gy, dx, dy):
                    a = grad[gy][gx]
                    return math.cos(a)*dx + math.sin(a)*dy
                s = d(ix, iy, fx, fy)
                t = d(ix+1, iy, fx-1, fy)
                u = d(ix, iy+1, fx, fy-1)
                v = d(ix+1, iy+1, fx-1, fy-1)
                sx = fx*fx*(3-2*fx)
                sy = fy*fy*(3-2*fy)
                val = (1-sx)*(1-sy)*s + sx*(1-sy)*t + (1-sx)*sy*u + sx*sy*v
                grid[y][x] += val * amp
    mn = min(min(r) for r in grid)
    mx = max(max(r) for r in grid)
    if mx - mn < 1e-9:
        return [[0.5]*w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            grid[y][x] = (grid[y][x] - mn) / (mx - mn)
    return grid

# ── 3x3 box blur (in-place safe) ──────────────────────────────────
def box_blur(pix, w, h, radius=1):
    out = [[(0,0,0) for _ in range(w)] for _ in range(h)]
    for y in range(h):
        for x in range(w):
            tot = [0, 0, 0]
            cnt = 0
            for dy in range(-radius, radius+1):
                for dx in range(-radius, radius+1):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h:
                        r0, g0, b0 = pix[ny][nx]
                        tot[0] += r0; tot[1] += g0; tot[2] += b0
                        cnt += 1
            out[y][x] = (tot[0]//cnt, tot[1]//cnt, tot[2]//cnt)
    return out

# ── 1. Grass ───────────────────────────────────────────────────────
def make_grass(rng):
    n = perlin(W, W, rng, scale=6)
    pix = [[(0,0,0) for _ in range(W)] for _ in range(W)]
    for y in range(W):
        for x in range(W):
            v = n[y][x]
            g = int(75 + v * 100)
            r = int(25 + v * 60)
            b = int(15 + v * 40)
            if rng.random() < 0.015:
                r = min(255, r+50)
                g = min(255, g+40)
            pix[y][x] = (r, g, b)
    out = box_blur(pix, W, W, 1)
    write_png(os.path.join(OUT, 'grass.png'), out)
    print('  ✓ grass.png')

# ── 2. Stone ───────────────────────────────────────────────────────
def make_stone(rng):
    n = perlin(W, W, rng, scale=12)
    pix = [[(0,0,0) for _ in range(W)] for _ in range(W)]
    for y in range(W):
        for x in range(W):
            v = n[y][x]
            pix[y][x] = (int(80+v*50), int(85+v*45), int(95+v*40))
    # simple edge detect → darken seams
    edge = [[0.0]*W for _ in range(W)]
    for y in range(1, W-1):
        for x in range(1, W-1):
            gx = pix[y-1][x+1][0] + 2*pix[y][x+1][0] + pix[y+1][x+1][0] \
                - pix[y-1][x-1][0] - 2*pix[y][x-1][0] - pix[y+1][x-1][0]
            gy = pix[y+1][x-1][1] + 2*pix[y+1][x][1] + pix[y+1][x+1][1] \
                - pix[y-1][x-1][1] - 2*pix[y-1][x][1] - pix[y-1][x+1][1]
            edge[y][x] = math.sqrt(gx*gx + gy*gy)
    mx = max(max(r) for r in edge) or 1
    for y in range(W):
        for x in range(W):
            if edge[y][x] > mx * 0.3:
                r0, g0, b0 = pix[y][x]
                pix[y][x] = (max(0,r0-50), max(0,g0-50), max(0,b0-50))
    out = box_blur(pix, W, W, 1)
    write_png(os.path.join(OUT, 'stone.png'), out)
    print('  ✓ stone.png')

# ── 3. Sand ────────────────────────────────────────────────────────
def make_sand(rng):
    n = perlin(W, W, rng, scale=4)
    pix = [[(0,0,0) for _ in range(W)] for _ in range(W)]
    for y in range(W):
        for x in range(W):
            v = n[y][x]
            pix[y][x] = (int(205+v*40), int(185+v*30), int(135+v*25))
    out = box_blur(pix, W, W, 2)
    # 高频噪声叠加
    for y in range(W):
        for x in range(W):
            r0, g0, b0 = out[y][x]
            d = rng.randint(-15, 15)
            out[y][x] = (max(0,min(255,r0+d)), max(0,min(255,g0+d)), max(0,min(255,b0+d)))
    write_png(os.path.join(OUT, 'sand.png'), out)
    print('  ✓ sand.png')

# ── Main ────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print(f'生成地面纹理 {W}x{W} → {OUT}')
    rng = random.Random(42)
    make_grass(rng)
    make_stone(rng)
    make_sand(rng)
    print('完成。')
