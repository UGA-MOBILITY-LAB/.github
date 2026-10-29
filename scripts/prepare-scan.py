"""Build the compact Hawkinsville scan for the homepage 3D viewer (requires numpy).

Usage: python3 scripts/prepare-scan.py RELEASE_DIR

RELEASE_DIR holds the two files of the lab's public rav-demo "data" release
(https://github.com/UGA-MOBILITY-LAB/rav-demo/releases/tag/data): the Lanelet2 map
(*lanelet2_map.osm) and the LiDAR point cloud (*.pcd, binary x y z intensity). The
route challenges come from scripts/data/hawkinsville-challenges.json (rav-demo, MIT).

The 4.3 million points are thinned to about 2% around the road, keeping painted
markings (high LiDAR intensity) finer than the rest so they stay visible:
  docs/assets/hawkinsville-scan.bin.gz  quantized points and HD-map lane lines
  docs/assets/hawkinsville-spots.json   challenge spots in the same map frame

Binary layout (little-endian, gzipped): "HKV1", uint32 point count, uint32 line-vertex
count, float32 origin[3] and step[3] in metres, then uint16 x/y/z per point, one uint8
per point (low 4 bits: intensity level, next 3 bits: height-above-ground bucket), and
uint16 x/y/z per line vertex (pairs form segments).
"""
import gzip
import json
import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
CHALLENGES = ROOT / "scripts" / "data" / "hawkinsville-challenges.json"
PAINT = 35  # LiDAR intensity above which a road-level point is treated as paint
LAYERS = (  # (name, voxel size in metres)
    ("paint", 0.5),
    ("road", 2.0),
    ("roadside", 3.4),
)
STEP = (0.1, 0.1, 0.05)  # quantization in metres (x, y, z)
HEIGHTS = (0.4, 1, 2, 4, 8, 12, 16)  # height-above-ground bucket edges in metres


def read_map(path):
    root = ET.parse(path).getroot()
    nodes = {}
    for node in root.iter("node"):
        tags = {tag.get("k"): tag.get("v") for tag in node.iter("tag")}
        nodes[node.get("id")] = (float(tags["local_x"]), float(tags["local_y"]), float(tags.get("ele", 0)))
    ways = {way.get("id"): np.array([nodes[nd.get("ref")] for nd in way.iter("nd")]) for way in root.iter("way")}
    lanelets = {}
    for relation in root.iter("relation"):
        tags = {tag.get("k"): tag.get("v") for tag in relation.iter("tag")}
        if tags.get("type") == "lanelet":
            lanelets[relation.get("id")] = [ways[m.get("ref")] for m in relation.iter("member") if m.get("type") == "way" and m.get("role") in ("left", "right")]
    lines = [w for w in ways.values() if len(w) > 1]
    return lines, lanelets


def read_pcd(path):
    raw = path.read_bytes()
    start = raw.index(b"DATA binary\n") + len(b"DATA binary\n")
    return np.frombuffer(raw[start:], dtype="<f4").reshape(-1, 4).astype(np.float64)


def simplify(points, tolerance):
    """Ramer-Douglas-Peucker on x/y, keeping z with each kept vertex."""
    if len(points) < 3:
        return points
    a, b = points[0, :2], points[-1, :2]
    ab = b - a
    length = np.hypot(*ab) or 1e-9
    offset = points[1:-1, :2] - a
    distance = np.abs(ab[0] * offset[:, 1] - ab[1] * offset[:, 0]) / length
    index = int(np.argmax(distance)) + 1
    if distance[index - 1] <= tolerance:
        return points[[0, -1]]
    return np.vstack([simplify(points[: index + 1], tolerance)[:-1], simplify(points[index:], tolerance)])


def densify(lines, step):
    samples = []
    for line in lines:
        for a, b in zip(line[:-1], line[1:]):
            count = max(1, int(np.hypot(*(b[:2] - a[:2])) / step))
            samples.append(a + (b - a) * (np.arange(count + 1)[:, None] / count))
    return np.vstack(samples)


def dilate(mask, radius):
    out = mask.copy()
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            if 0 < dx * dx + dy * dy <= radius * radius:
                out |= np.roll(np.roll(mask, dx, 0), dy, 1)
    return out


def grid_mask(samples, origin, shape, cell, radius):
    mask = np.zeros(shape, bool)
    cells = np.floor((samples[:, :2] - origin) / cell).astype(int)
    inside = (cells[:, 0] >= 0) & (cells[:, 1] >= 0) & (cells[:, 0] < shape[0]) & (cells[:, 1] < shape[1])
    mask[cells[inside, 0], cells[inside, 1]] = True
    return dilate(mask, radius)


def lookup(mask, points, origin, cell):
    cells = np.floor((points[:, :2] - origin) / cell).astype(int)
    cells[:, 0] = cells[:, 0].clip(0, mask.shape[0] - 1)
    cells[:, 1] = cells[:, 1].clip(0, mask.shape[1] - 1)
    return mask[cells[:, 0], cells[:, 1]]


def voxel(points, size):
    keys = np.floor(points[:, :3] / size).astype(np.int64)
    _, index = np.unique(keys, axis=0, return_index=True)
    return points[np.sort(index)]


def main(release):
    osm = next(release.glob("*lanelet2_map.osm"))
    pcd = next(release.glob("*.pcd"))
    lines, lanelets = read_map(osm)
    cloud = read_pcd(pcd)
    origin = cloud[:, :2].min(0) - 1
    extent = cloud[:, :2].max(0) + 1 - origin
    samples = densify(lines, 0.25)
    # Ground: within 0.4 m of the lowest point in its 2 m column.
    column = np.floor((cloud[:, :2] - origin) / 2).astype(np.int64)
    key = column[:, 0] * 100000 + column[:, 1]
    order = np.argsort(key, kind="stable")
    unique, starts = np.unique(key[order], return_index=True)
    lowest = np.minimum.reduceat(cloud[order, 2], starts)
    floor = np.empty(len(cloud))
    floor[order] = np.repeat(lowest, np.diff(np.append(starts, len(cloud))))
    height = cloud[:, 2] - floor
    ground = height < 0.4
    near_line = lookup(grid_mask(samples, origin, tuple(np.ceil(extent / 0.5).astype(int)), 0.5, 1), cloud, origin, 0.5)
    road = lookup(grid_mask(samples, origin, tuple(np.ceil(extent / 1.0).astype(int)), 1.0, 7), cloud, origin, 1.0)
    corridor = lookup(grid_mask(samples, origin, tuple(np.ceil(extent / 4.0).astype(int)), 4.0, 4), cloud, origin, 4.0)
    layers = {
        "paint": ground & near_line & (cloud[:, 3] >= PAINT),
        "road": ground & road & ~(near_line & (cloud[:, 3] >= PAINT)),
        "roadside": corridor & ~(ground & road),
    }
    kept = []
    for name, size in LAYERS:
        points = voxel(np.column_stack([cloud[layers[name]], height[layers[name]]]), size)
        print(f"{name}: {layers[name].sum():,} -> {len(points):,} points")
        kept.append(points)
    points = np.vstack(kept)
    # Quantize to 16-bit positions in a shared box with the map lines.
    lo = np.array([*origin, min(points[:, 2].min(), samples[:, 2].min()) - 1])
    scale = np.array(STEP)
    if np.any((np.array([*(origin + extent), points[:, 2].max()]) - lo) / scale > 65535):
        raise ValueError("scan does not fit 16-bit positions at this step")
    quantize = lambda xyz: np.round((xyz - lo) / scale).clip(0, 65535).astype("<u2")
    level = np.round(np.sqrt(points[:, 3].clip(0, 255) / 255) * 15).astype("u1")
    bucket = np.searchsorted(np.array(HEIGHTS), points[:, 4], side="right").astype("u1")
    segments = []
    for line in lines:
        simple = simplify(line, 0.15)
        segments.extend(np.repeat(simple, 2, axis=0)[1:-1])
    segments = np.array(segments)
    header = b"HKV1" + struct.pack("<II3f3f", len(points), len(segments), *lo, *scale)
    body = b"".join([
        quantize(points[:, :3]).tobytes(),
        (level | (bucket << 4)).astype("u1").tobytes(),
        quantize(segments).tobytes(),
    ])
    destination = ASSETS / "hawkinsville-scan.bin.gz"
    destination.write_bytes(gzip.compress(header + body, 9, mtime=0))
    print(f"{destination.name}: {len(points):,} points, {len(segments) // 2:,} line segments, {destination.stat().st_size:,} bytes gzipped")
    spots = []
    challenges = json.loads(CHALLENGES.read_text())
    for item in challenges["items"]:
        if "lanelets" in item:
            boundary = np.vstack([w for lanelet in item["lanelets"] for w in lanelets[str(lanelet)]])
            x, y = boundary[:, :2].mean(0)
            z = boundary[np.argmin(np.hypot(*(boundary[:, :2] - [x, y]).T)), 2]
            # Report how far the lanelet runs, so the camera can frame it.
            span = float(np.hypot(*(boundary[:, :2].max(0) - boundary[:, :2].min(0))))
        else:
            x, y = item["x"], item["y"]
            z = samples[np.argmin(np.hypot(*(samples[:, :2] - [x, y]).T)), 2]
            span = 30.0
        spots.append({"cat": item["cat"], "note": item["note"], "desc": item["desc"], "position": [round(float(v), 2) for v in ((np.array([x, y, z]) - lo) / scale)], "span": round(span / float(scale[0]))})
    output = {"categories": challenges["categories"], "spots": spots}
    (ASSETS / "hawkinsville-spots.json").write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"hawkinsville-spots.json: {len(spots)} spots")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
