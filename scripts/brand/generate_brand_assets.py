#!/usr/bin/env python3
"""Generate per-host brand assets (favicon.ico, apple-touch-icon.png,
icon-192.png, icon-512.png, og.png) from data/site_brand_assets.json.

Purpose: every site needs a favicon and a 1200x630 social card served from its
own host. No logos exist, so the marks are drawn from each site's palette and
initials; no stock imagery.

Inputs: data/site_brand_assets.json (hosts, colors, initials, tagline).
Outputs: repo root {favicon.ico,apple-touch-icon.png,icon-192.png,icon-512.png,og.png}.
The outputs are committed; the build only copies them (scripts/install_site_head_assets.js),
so this needs Pillow and a bold serif/sans font only when the art changes.

Use: python3 scripts/brand/generate_brand_assets.py [--font PATH]
"""
import argparse, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Georgia Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
]
SANS_CANDIDATES = [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
SANS_REG = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
]


def pick(cands, override=None):
    for p in ([override] if override else []) + cands:
        if p and os.path.exists(p):
            return p
    sys.exit('generate_brand_assets: no usable font found; pass --font')


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def centered(draw, box, text, font, fill):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    x = box[0] + (box[2] - box[0] - (r - l)) / 2 - l
    y = box[1] + (box[3] - box[1] - (b - t)) / 2 - t
    draw.text((x, y), text, font=font, fill=fill)


def icon(size, cfg, serif):
    bg, accent = hex_rgb(cfg['background']), hex_rgb(cfg['accent'])
    img = Image.new('RGB', (size, size), bg)
    d = ImageDraw.Draw(img)
    bar = max(1, round(size * 0.09))
    d.rectangle([0, size - bar, size, size], fill=accent)
    font = ImageFont.truetype(serif, round(size * 0.46))
    centered(d, (0, 0, size, size - bar), cfg['initials'], font, (255, 255, 255))
    return img


def og(cfg, host, serif, sans, sans_reg):
    W, H = 1200, 630
    bg, accent = hex_rgb(cfg['background']), hex_rgb(cfg['accent'])
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 18, H], fill=accent)
    mark = icon(160, cfg, serif)
    img.paste(mark, (90, 90))
    name_font = ImageFont.truetype(serif, 76)
    size = 76
    while d.textlength(cfg['name'], font=name_font) > W - 180 and size > 40:
        size -= 4
        name_font = ImageFont.truetype(serif, size)
    d.text((90, 300), cfg['name'], font=name_font, fill=(255, 255, 255))
    tag_font = ImageFont.truetype(sans_reg, 38)
    d.text((90, 300 + size + 34), cfg['tagline'], font=tag_font, fill=(203, 213, 225))
    d.rectangle([90, H - 120, 190, H - 114], fill=accent)
    d.text((90, H - 96), host + '  ·  Independent educational publisher', font=ImageFont.truetype(sans, 30), fill=accent)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--font')
    ap.add_argument('--config', default=os.path.join(ROOT, 'data', 'seo', 'site_brand_assets.json'))
    ap.add_argument('--out', default=ROOT)
    a = ap.parse_args()
    serif, sans, sans_reg = pick(FONT_CANDIDATES, a.font), pick(SANS_CANDIDATES), pick(SANS_REG)
    cfg = json.load(open(a.config))
    for host, c in cfg['hosts'].items():
        out = a.out  # single-host repo: files live at the repo root
        os.makedirs(out, exist_ok=True)
        base = icon(256, c, serif)
        base.save(os.path.join(out, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
        icon(180, c, serif).save(os.path.join(out, 'apple-touch-icon.png'), optimize=True)
        icon(192, c, serif).save(os.path.join(out, 'icon-192.png'), optimize=True)
        icon(512, c, serif).save(os.path.join(out, 'icon-512.png'), optimize=True)
        og(c, host, serif, sans, sans_reg).save(os.path.join(out, 'og.png'), optimize=True)
        print('brand assets:', host)


if __name__ == '__main__':
    main()
