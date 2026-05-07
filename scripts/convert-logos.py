"""
Convert the 4 WhatsApp JPEGs to transparent PNGs.

Strategy: detect background as the most-frequent color in a thin border
region (last column of pixels), which is more robust than corner sampling
when the logo touches the edge.
"""
import os
from collections import Counter
from PIL import Image

PUBLIC = os.path.join(os.path.dirname(__file__), '..', 'public')

# Per-file thresholds. White logos need a narrow threshold because their
# fill color (#FFFFFF) is close to the WhatsApp background (#F7F7F7) — only
# ~14 RGB-distance apart. Navy logos can use a wider threshold safely.
MAPPING = [
    ('WhatsApp Image 2026-04-29 at 14.48.14.jpeg', 'konekt-logo.png',       30, 20),
    ('WhatsApp Image 2026-04-29 at 14.48.28.jpeg', 'konekt-logo-white.png',  6,  4),
    ('WhatsApp Image 2026-04-29 at 14.48.44.jpeg', 'konekt-mark.png',       30, 20),
    ('WhatsApp Image 2026-04-29 at 14.49.02.jpeg', 'konekt-mark-white.png',  6,  4),
]


def detect_bg(img: Image.Image) -> tuple:
    """Find the background color = most frequent pixel value in a thin
    border around the image (1px-wide strip on all 4 sides).

    Quantize to 32-step buckets to merge anti-alias variations.
    """
    img = img.convert('RGB')
    w, h = img.size
    pixels = img.load()
    counts = Counter()
    BUCKET = 32  # quantization step
    border_pixels = []
    # 1-pixel border strip
    for x in range(w):
        border_pixels.append(pixels[x, 0])
        border_pixels.append(pixels[x, h - 1])
    for y in range(h):
        border_pixels.append(pixels[0, y])
        border_pixels.append(pixels[w - 1, y])
    for px in border_pixels:
        bucket = tuple((c // BUCKET) * BUCKET for c in px)
        counts[bucket] += 1
    most_common = counts.most_common(1)[0][0]
    # Recompute exact average within that bucket for sub-pixel precision
    bucket_pixels = [
        px for px in border_pixels
        if all(abs(c - bc) < BUCKET for c, bc in zip(px, most_common))
    ]
    if not bucket_pixels:
        return most_common
    avg = tuple(int(sum(p[i] for p in bucket_pixels) / len(bucket_pixels)) for i in range(3))
    return avg


def color_distance(c1, c2):
    return sum((a - b) ** 2 for a, b in zip(c1[:3], c2[:3])) ** 0.5


def remove_bg(img: Image.Image, threshold: int, feather: int) -> Image.Image:
    img = img.convert('RGBA')
    bg = detect_bg(img)
    print(f'  bg detected: rgb{bg}')
    w, h = img.size
    pixels = img.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            d = color_distance((r, g, b), bg)
            if d < threshold:
                pixels[x, y] = (r, g, b, 0)
            elif d < threshold + feather:
                ratio = (d - threshold) / feather
                pixels[x, y] = (r, g, b, int(255 * ratio))
    return img


for src_name, dst_name, threshold, feather in MAPPING:
    src = os.path.join(PUBLIC, src_name)
    dst = os.path.join(PUBLIC, dst_name)
    if not os.path.exists(src):
        print(f'SKIP missing: {src_name}')
        continue
    print(f'Converting {src_name} -> {dst_name} (threshold={threshold}, feather={feather})')
    img = Image.open(src)
    out = remove_bg(img, threshold=threshold, feather=feather)
    out.save(dst, 'PNG', optimize=True)
    size_kb = os.path.getsize(dst) / 1024
    print(f'  saved {dst_name} ({size_kb:.1f} KB)')
