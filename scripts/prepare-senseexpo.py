"""Rebuild the SenseExpo exploration map shown on the 3D scenes & robot exploration thread (needs numpy, Pillow).

Usage: python3 scripts/prepare-senseexpo.py SenseExpo.gif

The input is docs/SenseExpo.gif from the paper authors' repository
(https://github.com/senselabrobo/SenseExpo). The script takes frame 100 (step 596),
crops the SenseExpo map panel, snaps every pixel to the figure's flat colours (removing
GIF dithering and specks), upscales each colour region smoothly, and writes
docs/assets/senseexpo-exploration.webp at three times the panel's size.
"""
import sys
from collections import Counter, deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageSequence

OUTPUT = Path(__file__).resolve().parents[1] / "docs" / "assets" / "senseexpo-exploration.webp"
FRAME, PANEL = 100, (282, 433, 689, 610)
# Legend colours as k-means seeds: background, observed, predicted free, predicted obstacle,
# uncertain, true boundary, robot path, panel border.
SEEDS = [[19, 30, 57], [243, 163, 23], [230, 199, 148], [255, 253, 241], [128, 128, 128], [104, 84, 190], [220, 30, 30], [10, 14, 23]]
PATH_SEED = 6
SCALE, OUT_SCALE = 6, 3


def flat_labels(image):
    pixels = np.asarray(image).astype(np.float32).reshape(-1, 3)
    centers = np.array(SEEDS, np.float32)
    for _ in range(12):
        labels = ((pixels[:, None, :] - centers[None]) ** 2).sum(-1).argmin(1)
        for k in range(len(centers)):
            if (labels == k).any():
                centers[k] = pixels[labels == k].mean(0)
    return labels.reshape(image.height, image.width), centers


def remove_specks(labels, largest=2):
    """Give 4-connected regions of at most `largest` pixels to their most common neighbour."""
    height, width = labels.shape
    seen = np.zeros_like(labels, bool)
    neighbours = lambda y, x: [(y + dy, x + dx) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)) if 0 <= y + dy < height and 0 <= x + dx < width]
    for y in range(height):
        for x in range(width):
            if seen[y, x]:
                continue
            k, region, queue = labels[y, x], [(y, x)], deque([(y, x)])
            seen[y, x] = True
            while queue:
                for n in neighbours(*queue.popleft()):
                    if not seen[n] and labels[n] == k:
                        seen[n] = True
                        region.append(n)
                        queue.append(n)
            if len(region) <= largest:
                around = Counter(int(labels[n]) for p in region for n in neighbours(*p) if labels[n] != k)
                if around:
                    for p in region:
                        labels[p] = around.most_common(1)[0][0]
    return labels


def main(gif):
    frame = next(f for i, f in enumerate(ImageSequence.Iterator(Image.open(gif))) if i == FRAME)
    panel = frame.convert("RGB").crop(PANEL)
    labels, centers = flat_labels(panel)
    labels = remove_specks(labels)
    height, width = labels.shape
    masks = []
    for k in range(len(centers)):
        mask = Image.fromarray(((labels == k) * 255).astype(np.uint8)).resize((width * SCALE, height * SCALE), Image.Resampling.BICUBIC)
        masks.append(np.asarray(mask.filter(ImageFilter.GaussianBlur(SCALE * 0.45))).astype(np.float32))
    masks = np.stack(masks)
    big = masks.argmax(0)
    big[masks[PATH_SEED] > 70] = PATH_SEED  # keep the thin path continuous
    image = Image.fromarray(centers[big].clip(0, 255).astype(np.uint8))
    image.resize((width * OUT_SCALE, height * OUT_SCALE), Image.Resampling.LANCZOS).save(OUTPUT, "WEBP", quality=90, method=6)
    print(f"{OUTPUT.name}: {width * OUT_SCALE} x {height * OUT_SCALE}, {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main(sys.argv[1])
