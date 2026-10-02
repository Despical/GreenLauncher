from pathlib import Path
from io import BytesIO

import cairosvg
from PIL import Image, ImageDraw, ImageOps

root = Path(__file__).resolve().parents[1]
svg = root / 'build' / 'launcher-mark.svg'
image = Image.open(BytesIO(cairosvg.svg2png(url=str(svg), output_width=1024, output_height=1024))).convert('RGBA')
image.save(root / 'build' / 'launcher-mark.png')
image.save(root / 'build' / 'icon.png')
image.save(root / 'build' / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

tray_svg = root / 'build' / 'tray-mark.svg'
tray = Image.open(BytesIO(cairosvg.svg2png(url=str(tray_svg), output_width=512, output_height=512))).convert('RGBA')
tray.save(root / 'build' / 'tray-icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

size = (680, 360)
landscape = Image.open(root / 'src' / 'renderer' / 'assets' / 'green-landscape.png').convert('RGB')
splash = ImageOps.fit(landscape, size, method=Image.Resampling.LANCZOS, centering=(0.53, 0.5)).convert('RGBA')
shade = Image.new('RGBA', size, (0, 0, 0, 0))
shade_draw = ImageDraw.Draw(shade)
for x in range(size[0]):
    left = max(0, 1 - x / 510)
    shade_draw.line((x, 0, x, size[1]), fill=(7, 14, 21, int(225 * left + 48)))
bottom_shade = Image.new('RGBA', size, (0, 0, 0, 0))
bottom_draw = ImageDraw.Draw(bottom_shade)
for y in range(size[1]):
    bottom = max(0, (y - 230) / 130)
    if bottom:
        bottom_draw.line((0, y, size[0], y), fill=(7, 14, 21, int(95 * bottom)))
splash = Image.alpha_composite(Image.alpha_composite(splash, shade), bottom_shade)
block = image.resize((82, 82), Image.Resampling.LANCZOS)
splash.paste(block, (39, 42), block)
splash.save(root / 'build' / 'portable-splash.png', format='PNG')
splash.convert('RGB').save(root / 'build' / 'portable-splash.bmp', format='BMP')
