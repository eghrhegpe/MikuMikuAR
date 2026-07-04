#!/usr/bin/env python3
"""生成三张 512x512 程序化地面纹理：草地 / 石板 / 沙滩
依赖：Pillow（pip install Pillow）
输出：frontend/public/textures/grass.jpg, stone.jpg, sand.jpg
"""

import random, os, math
from PIL import Image, ImageDraw, ImageFilter

W = 512
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(SCRIPT_DIR, '..', 'frontend', 'public', 'textures'))
os.makedirs(OUT, exist_ok=True)

SEED = 42
rng = random.Random(SEED)

# ── 辅助：简易 Perlin 噪声 ───────────────────────────────────────────
def perlin_noise(w, h, scale=8):
    """4 倍频值噪声，返回 list[list[float]] 0~1"""
    freqs = [1, 2, 4, 8]
    amps = [1.0, 0.5, 0.25, 0.125]
    grid = [[0.0] * w for _ in range(h)]
    for octave, (freq, amp) in enumerate(zip(freqs, amps)):
        # 随机梯度网格
        gw = int(w / scale * freq) + 2
        gh = int(h / scale * freq) + 2
        grad = [[rng.random() * math.pi * 2 for _ in range(gw)] for _ in range(gh)]
        for y in range(h):
            for x in range(w):
                # 归一化坐标
                nx = (x / w) * scale * freq
                ny = (y / h) * scale * freq
                ix, iy = int(nx), int(ny)
                fx, fy = nx - ix, ny - iy
                # 双线性插值
                def dot(gx, gy, dx, dy):
                    return math.cos(grad[gy][gx]) * dx + math.sin(grad[gy][gx]) * dy
                v00 = dot(ix, iy, fx, fy)
                v10 = dot(ix+1, iy, fx-1, fy)
                v01 = dot(ix, iy+1, fx, fy-1)
                v11 = dot(ix+1, iy+1, fx-1, fy-1)
                tx, ty = fx*fy*(3-2*fx), fy*fy*(3-2*fy)  # smoothstep
                v = (1-tx)*(1-ty)*v00 + tx*(1-ty)*v10 + (1-tx)*ty*v01 + tx*ty*v11
                grid[y][x] += v * amp
    # 归一化到 0~1
    mn, mx = min(min(r) for r in grid), max(max(r) for r in grid)
    for y in range(h):
        for x in range(w):
            grid[y][x] = (grid[y][x] - mn) / (mx - mn + 1e-9)
    return grid

# ── 1. 草地 grass.jpg ────────────────────────────────────────────────
def make_grass():
    n = perlin_noise(W, W, scale=6)
    base = Image.new('RGB', (W, W))
    pix = base.load()
    for y in range(W):
        for x in range(W):
            v = n[y][x]
            g = int(75 + v * 100)
            r = int(25 + v * 60)
            b = int(15 + v * 40)
            # 随机草簇亮点
            if rng.random() < 0.015:
                r = min(255, r + 50)
                g = min(255, g + 40)
            pix[x, y] = (r, g, b)
    base = base.filter(ImageFilter.GaussianBlur(radius=1.2))
    # 高频细节叠加
    detail = Image.new('L', (W, W))
    dpix = detail.load()
    for y in range(W):
        for x in range(W):
            dpix[x, y] = rng.randint(0, 50)
    base = Image.blend(base, Image.merge('RGB', [detail, detail, detail]), 0.15)
    base = base.filter(ImageFilter.SHARPEN())
    base.save(os.path.join(OUT, 'grass.jpg'), 'JPEG', quality=92)
    print('  ✓ grass.jpg')

# ── 2. 石板 stone.jpg ────────────────────────────────────────────────
def make_stone():
    n = perlin_noise(W, W, scale=12)
    base = Image.new('RGB', (W, W))
    pix = base.load()
    for y in range(W):
        for x in range(W):
            v = n[y][x]
            r = int(80 + v * 50)
            g = int(85 + v * 45)
            b = int(95 + v * 40)
            pix[x, y] = (r, g, b)
    # 边缘检测 → 模拟石板缝隙
    gray = base.convert('L')
    edge = gray.filter(ImageFilter.EDGE_ENHANCE_MORE())
    epix = edge.load()
    pix = base.load()
    for y in range(W):
        for x in range(W):
            if epix[x, y] > 160:
                r, g, b = pix[x, y]
                pix[x, y] = (max(0, r-50), max(0, g-50), max(0, b-50))
    # 脏斑
    for _ in range(80):
        cx, cy = rng.randint(0, W-1), rng.randint(0, W-1)
        r2 = rng.randint(8, 25)
        draw = ImageDraw.Draw(base)
        col = (rng.randint(60,100), rng.randint(55,95), rng.randint(65,105))
        draw.ellipse([cx-r2, cy-r2, cx+r2, cy+r2], fill=col)
    base = base.filter(ImageFilter.GaussianBlur(radius=1.0))
    base.save(os.path.join(OUT, 'stone.jpg'), 'JPEG', quality=92)
    print('  ✓ stone.jpg')

# ── 3. 沙滩 sand.jpg ──────────────────────────────────────────────────
def make_sand():
    n = perlin_noise(W, W, scale=4)
    base = Image.new('RGB', (W, W))
    pix = base.load()
    for y in range(W):
        for x in range(W):
            v = n[y][x]
            r = int(205 + v * 40)
            g = int(185 + v * 30)
            b = int(135 + v * 25)
            pix[x, y] = (r, g, b)
    base = base.filter(ImageFilter.GaussianBlur(radius=2.5))
    # 细沙高频噪声
    fine = Image.new('L', (W, W))
    fpix = fine.load()
    for y in range(W):
        for x in range(W):
            fpix[x, y] = rng.randint(0, 35)
    fine_rgb = Image.merge('RGB', [fine, fine, fine])
    base = Image.blend(base, fine_rgb, 0.2)
    # 湿沙暗斑
    draw = ImageDraw.Draw(base)
    for _ in range(150):
        cx, cy = rng.randint(0, W-1), rng.randint(0, W-1)
        r2 = rng.randint(10, 35)
        col = (rng.randint(130,170), rng.randint(110,150), rng.randint(80,120))
        draw.ellipse([cx-r2, cy-r2, cx+r2, cy+r2], fill=col)
    base = base.filter(ImageFilter.GaussianBlur(radius=4.0))
    base.save(os.path.join(OUT, 'sand.jpg'), 'JPEG', quality=92)
    print('  ✓ sand.jpg')

# ── 主入口 ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print(f'生成地面纹理 512x512 → {OUT}')
    make_grass()
    make_stone()
    make_sand()
    print('完成。')
