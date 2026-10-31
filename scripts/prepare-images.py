"""Create display-sized WebP copies, figure details and favicons from the credited originals (requires Pillow).

Originals are never modified: pages link to them for full-size viewing, and
scripts/build.mjs adds every <stem>-<width>.webp copy it finds to that image's srcset.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps


DOCS = Path(__file__).resolve().parents[1] / "docs"
ASSETS = DOCS / "assets"
VARIANTS = {
    # Full-bleed Georgia hero scenes.
    "assets/athens-downtown.jpg": (720, 1280, 1920),
    "assets/rural-georgia-road.jpg": (720, 1280, 1920),
    "assets/atlanta-mobility.jpg": (720, 1280, 1920),
    # Research figures and lab photographs shown in page columns.
    "assets/drivedegrade-overview.png": (640, 1280),
    "assets/falcon-overview.png": (640, 960, 1280),
    "assets/lab-travels-pulaski-visit-2026.png": (240, 720, 1280),
    # The vehicle cutout keeps its transparency: a field-site card thumbnail on the research
    # page, and a full-size WebP for the homepage, about a tenth of the PNG's size.
    "assets/research-vehicle.png": (240, 719),
    "assets/lab-capstone-award-2026.jpg": (720, 1280),
    "assets/lab-ev-field-experiment.png": (720, 1236),
    # Homepage research mosaic. The Hawkinsville view is rendered from the lab's public
    # HD-map and point-cloud release in its rav-demo viewer.
    "assets/dinolink-overview.webp": (640, 960, 1280),
    "assets/hawkinsville-lidar-hdmap.webp": (640, 960, 1280),
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
# Hero scenes also get AVIF copies, about half the size of the WebP ones at the same visual quality.
AVIF_VARIANTS = ("assets/athens-downtown.jpg", "assets/rural-georgia-road.jpg", "assets/atlanta-mobility.jpg")
# Detail crops: (source, output stem, crop box in source pixels, widths).
# The DriveDegrade detail keeps the surround-view input and the degradation injector.
CROPS = [("assets/drivedegrade-overview.png", "drivedegrade-detail", (0, 0, 2275, 1062), (480, 960))]
# Team portraits: head-and-shoulders crops (4:5) with the head at about 40% of the frame height,
# so snapshots taken in very different settings line up as a set. Boxes are in source pixels.
PORTRAITS = [
    ("Tianle.jpg", "Tianle-portrait", (366, 1187, 1876, 3074), (480, 960)),
    ("assets/haohua-iros-2026-wide.jpg", "haohua-iros-2026-wide-portrait", (868, 230, 1352, 835), (480,)),
    ("qianyi.jpg", "qianyi-portrait", (206, 133, 938, 1048), (480,)),
]
# The GA-72 experiment route, redrawn in UGA red on a grey basemap. Map data © OpenStreetMap contributors.
ROUTE_MAP = ("assets/ev-car-following-route.png", "ev-car-following-route-red", (500, 478), (640, 960, 1280))
UGA_RED = (186, 12, 47)
# The car-and-signal mark from the lab logo, squared for browser tabs and home screens.
LOGO = DOCS / "image.png"
LOGO_MARK = (103, 10, 309, 256)
ICONS = {"favicon-32.png": 32, "apple-touch-icon.png": 180}


def save_widths(image, stem, widths, icc_profile=None):
    for width in widths:
        if width > image.width:
            raise ValueError(f"{stem} is smaller than {width}px")
        height = round(image.height * width / image.width)
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        destination = ASSETS / f"{stem}-{width}.webp"
        resized.save(destination, "WEBP", quality=82, method=6, icc_profile=icc_profile)
        print(f"{destination.name}: {destination.stat().st_size:,} bytes")


def open_original(name):
    with Image.open(DOCS / name) as original:
        # Keep the colour profile (e.g. Display P3 phone photos) so copies render the same colours.
        icc_profile = original.info.get("icc_profile")
        image = ImageOps.exif_transpose(original)
        # Keep transparency only where an image actually uses it.
        alpha = "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255
        return image.convert("RGBA" if alpha else "RGB"), icc_profile


def responsive_copies():
    for name, widths in VARIANTS.items():
        image, icc_profile = open_original(name)
        save_widths(image, Path(name).stem, widths, icc_profile)


def avif_copies():
    for name in AVIF_VARIANTS:
        image, _ = open_original(name)
        for width in VARIANTS[name]:
            resized = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
            destination = ASSETS / f"{Path(name).stem}-{width}.avif"
            resized.save(destination, "AVIF", quality=55, speed=4)
            print(f"{destination.name}: {destination.stat().st_size:,} bytes")


def detail_crops():
    for name, stem, box, widths in CROPS:
        image, icc_profile = open_original(name)
        save_widths(image.crop(box), stem, widths, icc_profile)


def portraits():
    for source, stem, box, widths in PORTRAITS:
        image, icc_profile = open_original(source)
        save_widths(image.crop(box), stem, widths, icc_profile)


def route_map():
    name, stem, seed, widths = ROUTE_MAP
    image, _ = open_original(name)
    image = image.convert("RGB")
    hue, saturation, _ = image.convert("HSV").split()
    # The route is the only saturated violet on the basemap (hue 225-320 degrees).
    violet = ImageChops.multiply(hue.point(lambda h: 255 if 160 <= h <= 227 else 0), saturation.point(lambda s: 255 if s > 56 else 0))
    mask = violet.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3))
    # Keep only the line connected to a known route pixel, dropping violet map labels.
    ImageDraw.floodfill(mask, seed, 128)
    mask = mask.point(lambda v: 255 if v == 128 else 0).filter(ImageFilter.GaussianBlur(0.8))
    basemap = ImageOps.grayscale(image).point(lambda g: round(255 - (255 - g) * 0.6)).convert("RGB")
    save_widths(Image.composite(Image.new("RGB", image.size, UGA_RED), basemap, mask), stem, widths)


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
    avif_copies()
    detail_crops()
    portraits()
    route_map()
    icons()
