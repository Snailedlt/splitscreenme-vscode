"""The Discord webhook avatar (media/discord-avatar.png): the SplitScreen.Me logo with a { } badge.
python3 scripts/discord-avatar.py ../splitscreenme-www/static/img/splitscreen-me-logo.png media/discord-avatar.png /tmp/preview.png
Drawn at 4x and scaled down for smooth edges. Kept inside the circle Discord crops avatars to."""
import sys
from PIL import Image, ImageDraw, ImageFont

logo_path, out, preview = sys.argv[1], sys.argv[2], sys.argv[3]
S = 4
W = 512 * S
bg = (26, 32, 48, 255)
img = Image.new('RGBA', (W, W), bg)

# The logo, centred a little up and left so the badge has room.
logo = Image.open(logo_path).convert('RGBA')
size = 300 * S
logo = logo.resize((size, size), Image.LANCZOS)
lx = ly = (W - size) // 2 - 14 * S
img.alpha_composite(logo, (lx, ly))

# The badge: a dark ring and a bright disc with { }.
d = ImageDraw.Draw(img)
cx, cy, r = 352 * S, 352 * S, 74 * S
d.ellipse((cx - r - 12 * S, cy - r - 12 * S, cx + r + 12 * S, cy + r + 12 * S), fill=bg)
d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 92 * S)
text = '{}'
box = d.textbbox((0, 0), text, font=font)
tw, th = box[2] - box[0], box[3] - box[1]
d.text((cx - tw / 2 - box[0], cy - th / 2 - box[1] - 4 * S), text, font=font, fill=(30, 120, 240, 255))

final = img.resize((512, 512), Image.LANCZOS)
final.save(out, optimize=True)

# What Discord shows: a circle, at a small size too.
mask = Image.new('L', (512, 512), 0)
ImageDraw.Draw(mask).ellipse((0, 0, 511, 511), fill=255)
round_ = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
round_.paste(final, (0, 0), mask)
sheet = Image.new('RGBA', (512 + 40 + 128 + 40 + 40, 512), (49, 51, 56, 255))
sheet.alpha_composite(round_, (0, 0))
small = round_.resize((128, 128), Image.LANCZOS)
sheet.alpha_composite(small, (552, 192))
tiny = round_.resize((40, 40), Image.LANCZOS)
sheet.alpha_composite(tiny, (720, 236))
sheet.save(preview)
