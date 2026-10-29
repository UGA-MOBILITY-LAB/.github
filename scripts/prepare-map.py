"""Project and simplify the Georgia outline for the research page's field-site map.

Usage: python3 scripts/prepare-map.py ne_10m_admin_1_states_provinces_lakes.geojson

The input is Natural Earth's 1:10m states and provinces file (public domain,
https://www.naturalearthdata.com). The output, scripts/data/georgia-outline.json,
holds an SVG path in a 360-unit-wide frame and the projection that build.mjs uses
to place sites by latitude and longitude.
"""
import json
import math
import sys
from pathlib import Path

WIDTH = 360
TOLERANCE = 0.45  # simplification tolerance in output units
OUTPUT = Path(__file__).resolve().parent / "data" / "georgia-outline.json"


def simplify(points, tolerance):
    """Ramer-Douglas-Peucker."""
    if len(points) < 3:
        return points
    (ax, ay), (bx, by) = points[0], points[-1]
    length = math.hypot(bx - ax, by - ay) or 1e-9
    distances = [abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / length for x, y in points[1:-1]]
    index = max(range(len(distances)), key=distances.__getitem__) + 1
    if distances[index - 1] <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def main(source):
    features = json.loads(Path(source).read_text())["features"]
    georgia = next(f for f in features if f["properties"].get("iso_3166_2") == "US-GA")
    polygons = georgia["geometry"]["coordinates"]
    lons = [lon for polygon in polygons for lon, _ in polygon[0]]
    lats = [lat for polygon in polygons for _, lat in polygon[0]]
    lon_min, lat_max = min(lons), max(lats)
    # Equirectangular projection at Georgia's mid-latitude.
    kx = math.cos(math.radians((min(lats) + lat_max) / 2))
    k = WIDTH / ((max(lons) - lon_min) * kx)
    project = lambda lon, lat: ((lon - lon_min) * kx * k, (lat_max - lat) * k)
    height = (lat_max - min(lats)) * k
    paths = []
    for polygon in polygons:
        ring = [project(lon, lat) for lon, lat in polygon[0]]
        # A closed ring starts and ends at the same point, so split it at its farthest vertex.
        far = max(range(len(ring)), key=lambda i: math.dist(ring[0], ring[i]))
        ring = simplify(ring[: far + 1], TOLERANCE)[:-1] + simplify(ring[far:], TOLERANCE)
        xs, ys = [x for x, _ in ring], [y for _, y in ring]
        if max(xs) - min(xs) < 2 and max(ys) - min(ys) < 2:
            continue  # drop islands too small to see
        paths.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in ring) + "Z")
    output = {
        "source": "Natural Earth 1:10m admin-1 states and provinces (public domain)",
        "width": WIDTH,
        "height": round(height, 1),
        "projection": {"lonMin": lon_min, "latMax": lat_max, "kx": kx, "k": k},
        "path": "".join(paths),
    }
    OUTPUT.write_text(json.dumps(output) + "\n")
    print(f"{OUTPUT.name}: {len(output['path']):,} characters, {WIDTH} x {height:.0f}")


if __name__ == "__main__":
    main(sys.argv[1])
