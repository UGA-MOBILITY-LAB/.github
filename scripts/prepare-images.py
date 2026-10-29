"""Create display-sized WebP copies and favicons from the credited originals (requires Pillow).

Originals are never modified: pages link to them for full-size viewing, and
scripts/build.mjs adds every <stem>-<width>.webp copy it finds to that image's srcset.
"""
from pathlib import Path

from PIL import Image, ImageOps


DOCS = Path(__file__).resolve().parents[1] / "docs"
ASSETS = DOCS / "assets"
VARIANTS = {
    # Full-bleed Georgia hero scenes.
    "assets/athens-downtown.jpg": (720, 1280, 1920),
    "assets/rural-georgia-road.jpg": (720, 1280, 1920),
    "assets/atlanta-mobility.jpg": (720, 1280, 1920),
    # Research figures and lab photographs shown in page columns.
    "assets/drivedegrade-overview.png": (640, 1280),
    "assets/falcon-overview.png": (640, 1280),
    "assets/lab-travels-pulaski-visit-2026.png": (720, 1280),
    "assets/lab-capstone-award-2026.jpg": (720, 1280),
    "assets/lab-ev-field-experiment.png": (720, 1236),
    # NHTSA visit gallery. The 800px originals stay as the large candidate; only small copies help.
    "assets/lab-team-2026.jpg": (400,),
    "assets/nhtsa-visit-2026-group.jpg": (400,),
    "assets/nhtsa-visit-2026-vehicle.jpg": (400,),
    "assets/nhtsa-visit-2026-briefing.jpg": (400,),
    "assets/nhtsa-visit-2026-demonstration.jpg": (400,),
    "assets/nhtsa-visit-2026-equipment.jpg": (400,),
    # Portraits. qianyi.jpg is already smaller than a re-encoded copy would be.
    "HYao.jpg": (480, 960),
    "Tianle.jpg": (480, 960),
    "assets/haohua-iros-2026-wide.jpg": (480, 960),
}
# The car-and-signal mark from the lab logo, squared for browser tabs and home screens.
LOGO = DOCS / "image.png"
LOGO_MARK = (103, 10, 309, 256)
ICONS = {"favicon-32.png": 32, "apple-touch-icon.png": 180}


def responsive_copies():
    for name, widths in VARIANTS.items():
        source = DOCS / name
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original)
            # Keep transparency only where an image actually uses it.
            alpha = "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255
            image = image.convert("RGBA" if alpha else "RGB")
            for width in widths:
                if width > image.width:
                    raise ValueError(f"{source.name} is smaller than {width}px")
                height = round(image.height * width / image.width)
                resized = image.resize((width, height), Image.Resampling.LANCZOS)
                destination = ASSETS / f"{source.stem}-{width}.webp"
                resized.save(destination, "WEBP", quality=82, method=6)
                print(f"{destination.name}: {destination.stat().st_size:,} bytes")


def icons():
    with Image.open(LOGO) as logo:
        mark = logo.convert("RGB").crop(LOGO_MARK)
    side = max(mark.size) + 20
    square = Image.new("RGB", (side, side), "white")
    square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    for name, size in ICONS.items():
        destination = ASSETS / name
        square.resize((size, size), Image.Resampling.LANCZOS).save(destination, optimize=True)
        print(f"{destination.name}: {destination.stat().st_size:,} bytes")


if __name__ == "__main__":
    responsive_copies()
    icons()
