"""Render MikuMikuAR app icon (1024x1024) from the approved design spec.

Design: Miku cyan glassmorphism squircle tile + white twin-tail bust silhouette.
Outputs:
  build/appicon.png   (1024x1024, what `wails3 generate icons` consumes)
  build/appicon.svg   (vector master / version control)
"""
import math
import numpy as np
from PIL import Image, ImageDraw

SS = 2                 # supersample factor for anti-aliased edges
S = 1024
W = S * SS
RADIUS = 220 * SS

# --- palette -------------------------------------------------------------
C1 = np.array([57, 197, 187])    # #39C5BB Miku cyan
CM = np.array([28, 159, 196])    # #1C9FC4
C2 = np.array([14, 123, 166])    # #0E7BA6 deep teal


def cubic(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        u = i / n
        mu = 1 - u
        x = mu**3*p0[0] + 3*mu*mu*u*p1[0] + 3*mu*u*u*p2[0] + u**3*p3[0]
        y = mu**3*p0[1] + 3*mu*mu*u*p1[1] + 3*mu*u*u*p2[1] + u**3*p3[1]
        pts.append((x, y))
    return pts


# --- silhouette control points (512-space) -------------------------------
head = [(256 + 72*math.cos(2*math.pi*i/72), 150 + 72*math.sin(2*math.pi*i/72))
        for i in range(72)]
tail_l = (cubic((205,108),(150,120),(92,185),(86,300)) +
          cubic((86,300),(83,360),(92,420),(120,432)) +
          cubic((120,432),(112,392),(128,330),(168,272)) +
          cubic((168,272),(192,238),(205,180),(205,108)))
tail_r = (cubic((307,108),(362,120),(420,185),(426,300)) +
          cubic((426,300),(429,360),(420,420),(392,432)) +
          cubic((392,432),(400,392),(384,330),(344,272)) +
          cubic((344,272),(320,238),(307,180),(307,108)))
bust = (cubic((222,210),(200,220),(188,250),(188,300)) +
        cubic((188,300),(188,360),(200,400),(256,400)) +
        cubic((256,400),(312,400),(324,360),(324,300)) +
        cubic((324,300),(324,250),(312,220),(290,210)) +
        cubic((290,210),(278,230),(268,238),(256,238)) +
        cubic((256,238),(244,238),(234,230),(222,210)))
shapes = [head, tail_l, tail_r, bust]

allp = [p for sh in shapes for p in sh]
minx, maxx = min(p[0] for p in allp), max(p[0] for p in allp)
miny, maxy = min(p[1] for p in allp), max(p[1] for p in allp)
bw, bh = maxx - minx, maxy - miny

# scale to ~660px tall, centre horizontally, lift 10px up (optical centre)
s = (660.0 * SS) / bh
ox = (W - bw * s) / 2 - minx * s
oy = (W - bh * s) / 2 - miny * s - 10 * SS

# --- tile mask -----------------------------------------------------------
mask_img = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask_img).rounded_rectangle([0, 0, W-1, W-1], radius=RADIUS, fill=255)
mask = np.array(mask_img) > 0

ys, xs = np.mgrid[0:W, 0:W]
t = (xs / (W-1) + ys / (W-1)) / 2.0
f1 = np.clip(t / 0.5, 0, 1)
f2 = np.clip((t - 0.5) / 0.5, 0, 1)
col = np.where(t[:, :, None] < 0.5,
               C1[None, None, :]*(1-f1[:, :, None]) + CM[None, None, :]*f1[:, :, None],
               CM[None, None, :]*(1-f2[:, :, None]) + C2[None, None, :]*f2[:, :, None])
col = np.clip(col, 0, 255)

# glass sheen: white vertical alpha, fading out by 50% height
sheen = np.where(ys < W*0.5, np.clip(1 - ys/(W*0.5), 0, 1) * 0.35, 0.0)
col = col*(1 - sheen[:, :, None]) + 255*sheen[:, :, None]
col = np.clip(col, 0, 255)

out = np.zeros((W, W, 4), dtype=np.uint8)
out[mask, 0:3] = col[mask].astype(np.uint8)
out[mask, 3] = 255
img = Image.fromarray(out, "RGBA")

# border stroke
ImageDraw.Draw(img).rounded_rectangle(
    [0, 0, W-1, W-1], radius=RADIUS, outline=(255, 255, 255, 70), width=max(1, 3*SS))

# white silhouette on top
sil = ImageDraw.Draw(img)
for sh in shapes:
    poly = [(p[0]*s + ox, p[1]*s + oy) for p in sh]
    sil.polygon(poly, fill=(255, 255, 255, 255))

img = img.resize((S, S), Image.LANCZOS)
img.save(r"C:\Users\zhujieling11\MikuMikuAR\build\appicon.png")
print("wrote build/appicon.png", img.size)

# --- vector master (1024 space) ------------------------------------------
s_svg = 660.0 / bh
ox_svg = (S - bw * s_svg) / 2 - minx * s_svg
oy_svg = (S - bh * s_svg) / 2 - miny * s_svg - 10

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#39C5BB"/>
      <stop offset="0.5" stop-color="#1C9FC4"/>
      <stop offset="1" stop-color="#0E7BA6"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="{S}" height="{S}" rx="220" fill="url(#g)"/>
  <rect x="0" y="0" width="{S}" height="{S}" rx="220" fill="url(#sheen)"/>
  <rect x="0" y="0" width="{S}" height="{S}" rx="220" fill="none" stroke="#ffffff" stroke-opacity="0.27" stroke-width="3"/>
  <g transform="translate({ox_svg:.2f},{oy_svg:.2f}) scale({s_svg:.4f})" fill="#ffffff">
    <path d="M205,108 C150,120 92,185 86,300 C83,360 92,420 120,432 C112,392 128,330 168,272 C192,238 205,180 205,108 Z"/>
    <path d="M307,108 C362,120 420,185 426,300 C429,360 420,420 392,432 C400,392 384,330 344,272 C320,238 307,180 307,108 Z"/>
    <circle cx="256" cy="150" r="72"/>
    <path d="M222,210 C200,220 188,250 188,300 C188,360 200,400 256,400 C312,400 324,360 324,300 C324,250 312,220 290,210 C278,230 268,238 256,238 C244,238 234,230 222,210 Z"/>
  </g>
</svg>
'''
with open(r"C:\Users\zhujieling11\MikuMikuAR\build\appicon.svg", "w", encoding="utf-8") as f:
    f.write(svg)
print("wrote build/appicon.svg")
