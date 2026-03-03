from PIL import Image, ImageDraw
import math, os, subprocess

SIZE = 1024
PAD = 100
CORNER = 195
CX, CY = SIZE // 2, SIZE // 2

def lerp(a, b, t):
    return int(a + (b - a) * t)

def make_squircle_mask(size, pad, radius):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [pad, pad, size - pad, size - pad], radius=radius, fill=255)
    return mask

def draw_smooth_arc(img, cx, cy, r, start_deg, end_deg, width, color, steps=800):
    """Draw arc by stamping circles along the path for perfect smoothness."""
    draw = ImageDraw.Draw(img)
    hw = width // 2
    for i in range(steps + 1):
        t = i / steps
        angle = math.radians(start_deg + (end_deg - start_deg) * t)
        x = cx + r * math.cos(angle)
        y = cy + r * math.sin(angle)
        draw.ellipse([x - hw, y - hw, x + hw, y + hw], fill=color)
    end_angle = math.radians(end_deg)
    ex = cx + r * math.cos(end_angle)
    ey = cy + r * math.sin(end_angle)
    return (ex, ey)

# --- Background gradient ---
gradient = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
for y in range(SIZE):
    for x in range(SIZE):
        t = (x + y) / (2 * SIZE)
        gradient.putpixel((x, y), (lerp(67, 124, t), lerp(56, 58, t), lerp(202, 237, t), 255))

mask = make_squircle_mask(SIZE, PAD, CORNER)
icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
icon.paste(gradient, (0, 0), mask)

# --- Draw timer elements on overlay ---
overlay = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)

R = 195
LW = 40

# Background ring (full circle, subtle)
draw_smooth_arc(overlay, CX, CY, R, 0, 360, LW, (255, 255, 255, 28))

# Foreground arc: from 12 o'clock (−90°) sweeping 270° clockwise to 9 o'clock (180°)
end_pt = draw_smooth_arc(overlay, CX, CY, R, -90, 180, LW, (255, 255, 255, 210))

# Bright dot at arc end
DOT_R = 24
draw.ellipse([end_pt[0] - DOT_R, end_pt[1] - DOT_R,
              end_pt[0] + DOT_R, end_pt[1] + DOT_R],
             fill=(255, 255, 255, 255))

# Center dot
draw.ellipse([CX - 14, CY - 14, CX + 14, CY + 14], fill=(255, 255, 255, 180))

# Minute hand (pointing to 12)
hand_len = 130
hx, hy = CX, CY - hand_len
for i in range(100):
    t = i / 99
    px = CX + (hx - CX) * t
    py = CY + (hy - CY) * t
    draw.ellipse([px - 7, py - 7, px + 7, py + 7], fill=(255, 255, 255, 210))

# Hour hand (pointing to ~2 o'clock)
h_angle = math.radians(55)
h_len = 100
hx2 = CX + h_len * math.sin(h_angle)
hy2 = CY - h_len * math.cos(h_angle)
for i in range(100):
    t = i / 99
    px = CX + (hx2 - CX) * t
    py = CY + (hy2 - CY) * t
    draw.ellipse([px - 7, py - 7, px + 7, py + 7], fill=(255, 255, 255, 130))

icon = Image.alpha_composite(icon, overlay)

# Subtle border
border = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(border).rounded_rectangle(
    [PAD, PAD, SIZE - PAD, SIZE - PAD], radius=CORNER,
    fill=None, outline=(255, 255, 255, 18), width=2)
icon = Image.alpha_composite(icon, border)

icon.save('icon_1024.png')
print('Created icon_1024.png')

# --- Generate .iconset and .icns ---
iconset = 'StudyFlow.iconset'
os.makedirs(iconset, exist_ok=True)

for s in [16, 32, 64, 128, 256, 512]:
    icon.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
    s2 = s * 2
    if s2 <= 1024:
        icon.resize((s2, s2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))

icon.save(os.path.join(iconset, 'icon_512x512@2x.png'))
print(f'Created {iconset}/')

r = subprocess.run(['iconutil', '-c', 'icns', iconset], capture_output=True, text=True)
print('Created StudyFlow.icns' if r.returncode == 0 else f'Error: {r.stderr}')
