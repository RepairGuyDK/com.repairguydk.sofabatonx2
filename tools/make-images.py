#!/usr/bin/env python3
"""Turn two source photos into the exact PNGs the Homey App Store wants.

Usage:
    python tools/make-images.py

Put these in photos/ first (jpg or png, as large as you have):

  photos/hub.*   the SofaBaton X2 hub on a plain white background. Becomes the
                 driver images -- cropped, squared, padded and flattened onto
                 pure white.

  photos/app.*   a lively lifestyle photo (living room, remote in hand, ...).
                 Becomes the app images -- cropped to 10:7.

Two knobs below control the framing; both are tuned for the photos currently in
photos/ and should be revisited when you swap a source out.

Needs Pillow:  pip install Pillow
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PHOTOS = ROOT / "photos"

# Homey App Store sizes.
APP_SIZES = {"small": (250, 175), "large": (500, 350), "xlarge": (1000, 700)}
DRIVER_SIZES = {"small": (75, 75), "large": (500, 500), "xlarge": (1000, 1000)}

# Box (left, top, right, bottom) cutting the hub out of a wider product shot.
# Set to None when photos/hub.* is already the hub on its own.
HUB_CROP = (0, 444, 487, 933)

# Anything at or above this level in the hub shot is pulled to pure white, so a
# light grey studio backdrop comes out as the white background Homey asks for.
HUB_WHITE_POINT = 248

# Share of the driver square the hub fills; the rest is white margin.
HUB_FILL = 0.84

# Where the 10:7 window sits in the app photo: 0.0 = top, 1.0 = bottom.
# Bottom-aligned keeps the remote in the hand in frame.
APP_ANCHOR = 1.0


def find_source(stem):
    for ext in ("jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG"):
        p = PHOTOS / f"{stem}.{ext}"
        if p.exists():
            return p
    return None


def on_white(img):
    """Flatten any transparency onto white and drop to RGB."""
    img = img.convert("RGBA")
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, img).convert("RGB")


def crop_to_ratio(img, ratio, anchor=0.5):
    """Crop to the given width/height ratio, anchor picks the window position."""
    w, h = img.size
    if w / h > ratio:
        new_w = int(round(h * ratio))
        left = int(round((w - new_w) * anchor))
        return img.crop((left, 0, left + new_w, h))
    new_h = int(round(w / ratio))
    top = int(round((h - new_h) * anchor))
    return img.crop((0, top, w, top + new_h))


def write_app_images(src):
    img = crop_to_ratio(on_white(Image.open(src)), 10 / 7, APP_ANCHOR)
    out = ROOT / "assets" / "images"
    out.mkdir(parents=True, exist_ok=True)
    for name, size in APP_SIZES.items():
        img.resize(size, Image.LANCZOS).save(out / f"{name}.png", "PNG", optimize=True)
        print(f"  assets/images/{name}.png  {size[0]}x{size[1]}")


def write_driver_images(src):
    """Cut out the hub, whiten the backdrop and centre it on a white square."""
    img = on_white(Image.open(src))
    if HUB_CROP:
        img = img.crop(HUB_CROP)

    a = np.asarray(img).astype(np.float32)
    a = np.clip(a * (255.0 / HUB_WHITE_POINT), 0, 255)
    img = Image.fromarray(a.astype(np.uint8))

    # Trim the whitened border away so the hub really sits in the middle.
    ink = np.nonzero(np.asarray(img).astype(int).sum(axis=2) < 3 * 230)
    if len(ink[0]):
        img = img.crop((ink[1].min(), ink[0].min(), ink[1].max() + 1, ink[0].max() + 1))

    # Work at the largest size we ship, then scale down for the rest.
    target = max(max(s) for s in DRIVER_SIZES.values())
    inner_w = int(round(target * HUB_FILL))
    inner_h = int(round(img.height * inner_w / img.width))
    if inner_h > target * HUB_FILL:
        inner_h = int(round(target * HUB_FILL))
        inner_w = int(round(img.width * inner_h / img.height))

    square = Image.new("RGB", (target, target), (255, 255, 255))
    square.paste(
        img.resize((inner_w, inner_h), Image.LANCZOS),
        ((target - inner_w) // 2, (target - inner_h) // 2),
    )

    out = ROOT / "drivers" / "hub" / "assets" / "images"
    out.mkdir(parents=True, exist_ok=True)
    for name, size in DRIVER_SIZES.items():
        square.resize(size, Image.LANCZOS).save(out / f"{name}.png", "PNG", optimize=True)
        print(f"  drivers/hub/assets/images/{name}.png  {size[0]}x{size[1]}")


def main():
    missing = []

    hub = find_source("hub")
    if hub:
        print(f"Hub photo: {hub.name}")
        write_driver_images(hub)
    else:
        missing.append("photos/hub.jpg  (the SofaBaton X2 hub on white)")

    app = find_source("app")
    if app:
        print(f"App photo: {app.name}")
        write_app_images(app)
    else:
        missing.append("photos/app.jpg  (a lifestyle shot for the app page)")

    if missing:
        print("\nStill missing:")
        for m in missing:
            print(f"  - {m}")
        return 1
    print("\nDone. Now run: homey app validate --level publish")
    return 0


if __name__ == "__main__":
    sys.exit(main())
