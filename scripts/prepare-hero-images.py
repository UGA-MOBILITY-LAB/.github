"""Create responsive hero assets from the credited originals (requires Pillow)."""
from pathlib import Path

from PIL import Image, ImageOps


ASSETS = Path(__file__).resolve().parents[1] / "docs" / "assets"
SCENES = ("athens-downtown", "rural-georgia-road", "atlanta-mobility")
WIDTHS = (720, 1280, 1920)


def main():
    for scene in SCENES:
        source = ASSETS / f"{scene}.jpg"
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original).convert("RGB")
            for width in WIDTHS:
                if width > image.width:
                    raise ValueError(f"{source.name} is smaller than {width}px")
                height = round(image.height * width / image.width)
                resized = image.resize((width, height), Image.Resampling.LANCZOS)
                destination = ASSETS / f"{scene}-{width}.webp"
                resized.save(destination, "WEBP", quality=82, method=6)
                print(f"{destination.name}: {destination.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
