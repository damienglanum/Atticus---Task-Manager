#!/usr/bin/env python3
"""Draws the application icons from the contour mark.

Not part of `npm run verify`, and not run at build time: it writes binary assets
that are checked in. Run it when the mark changes.

    python3 scripts/generate-icons.py

Needs Pillow. Deliberately a generator rather than a hand-exported PNG: the app
icon uses the same compact contour geometry as the sidebar mark, then draws each
logical size and pixel density separately so its line weight survives at Dock
and favicon scale. Those renders are packed directly into the multi-resolution
`.icns` container.

The geometry is read from `src/components/ui/logoContours.ts`, so the icon and
the interface cannot disagree about what the mark is.
"""

from __future__ import annotations

import io
import math
import re
import struct
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - a developer-tooling path
    sys.exit("This script needs Pillow:  python3 -m pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
CONTOURS_TS = ROOT / "src" / "components" / "ui" / "logoContours.ts"
ICONS = ROOT / "src-tauri" / "icons"

# A cool graphite tile carries enough value to remain a shape in a dark Dock.
# Its restrained top light and narrow rim provide the same material boundary as
# neighbouring macOS icons without turning the brand into a glossy illustration.
# The contour itself stays solid and unblurred: clarity at 16–64 px comes from
# enough real cyan pixels, not a glow that becomes haze when macOS downsamples.
BACKGROUND_TOP = (39, 49, 55, 255)  # #273137
BACKGROUND_BOTTOM = (21, 26, 30, 255)  # #151a1e
BORDER = (71, 85, 93, 255)  # #47555d
STROKE = (110, 226, 241, 255)  # #6ee2f1
BACKGROUND_HEX = "#20282d"
STROKE_HEX = "#6ee2f1"

# macOS icons are not full-bleed: the artwork sits inside a rounded square with
# a margin, and the system expects that margin to be part of the image.
INSET = 0.10  # of the canvas, each side
CORNER = 0.225  # of the squircle's own side
# The mark's share of the squircle. 0.60 left it looking like a small object in
# a large box beside the other icons in the Dock — the squircle already supplies
# the breathing room that the artwork does not need to supply again.
MARK = 0.82
PACKAGED_RINGS = 3

SUPERSAMPLE = 4


def read_contours() -> list[str]:
    """The eight path strings, innermost first."""
    source = CONTOURS_TS.read_text()
    paths = re.findall(r'^  "(M .+?)",$', source, re.M)
    if len(paths) != 8:
        sys.exit(f"expected 8 contours in {CONTOURS_TS}, found {len(paths)}")
    return paths


def flatten(path: str, steps: int = 96) -> list[tuple[float, float]]:
    """Turns one `M … C … Z` path into a polyline.

    The artwork is only move-to and cubic curve-to, so this handles those two and
    nothing else; anything richer would need a real path parser and the artwork
    has never had it.
    """
    numbers = [float(n) for n in re.findall(r"-?\d+\.?\d*", path)]
    points: list[tuple[float, float]] = []

    start = (numbers[0], numbers[1])
    current = start
    points.append(current)

    rest = numbers[2:]
    for index in range(0, len(rest) - 5, 6):
        c1 = (rest[index], rest[index + 1])
        c2 = (rest[index + 2], rest[index + 3])
        end = (rest[index + 4], rest[index + 5])

        for step in range(1, steps + 1):
            t = step / steps
            u = 1 - t
            x = (
                u**3 * current[0]
                + 3 * u**2 * t * c1[0]
                + 3 * u * t**2 * c2[0]
                + t**3 * end[0]
            )
            y = (
                u**3 * current[1]
                + 3 * u**2 * t * c1[1]
                + 3 * u * t**2 * c2[1]
                + t**3 * end[1]
            )
            points.append((x, y))
        current = end

    points.append(start)  # the paths are all closed
    return points


def target_stroke(mark_pixels: float) -> float:
    """Visible line weight for one logical-size rendering of the mark.

    The old function stopped at 2.2 *output* pixels, including on the 1024 px
    master. Downsampling that master into the Dock reduced the cyan to a dim
    fraction of one pixel. Above compact sizes the stroke must scale with the
    artwork, while the small floor keeps 16–32 px variants crisp.
    """
    if mark_pixels < 28:
        return 1.7
    if mark_pixels < 56:
        return 2.1
    return mark_pixels * 0.042


def lerp_channel(start: int, end: int, amount: float) -> int:
    return round(start + (end - start) * amount)


def draw_tile(image: Image.Image, inset: float, square: float) -> None:
    """Composite the graphite material inside one rounded-square mask."""
    tile = Image.new("RGBA", image.size, (0, 0, 0, 0))
    tile_draw = ImageDraw.Draw(tile)
    top = round(inset)
    bottom = round(inset + square)
    for y in range(top, bottom + 1):
        amount = (y - top) / max(bottom - top, 1)
        color = tuple(
            lerp_channel(start, end, amount)
            for start, end in zip(BACKGROUND_TOP, BACKGROUND_BOTTOM)
        )
        tile_draw.line((inset, y, inset + square, y), fill=color)

    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [inset, inset, inset + square, inset + square],
        radius=square * CORNER,
        fill=255,
    )
    image.alpha_composite(Image.composite(tile, Image.new("RGBA", image.size), mask))

    # Roughly one output pixel at Dock scale. The rim is part of the tile rather
    # than a glow, so it remains defined against both dark and coloured shelves.
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        [inset, inset, inset + square, inset + square],
        radius=square * CORNER,
        outline=BORDER,
        width=max(1, round(square * 0.012)),
    )


def rings_for_size(logical_size: float) -> int:
    # Two loops survive 16–32 px notification, favicon, and list slots more
    # cleanly. Ordinary Dock and application representations keep the familiar
    # three without packing their gaps shut.
    return 2 if logical_size < 40 else PACKAGED_RINGS


def bounds(paths: list[str]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for path in paths:
        numbers = [float(n) for n in re.findall(r"-?\d+\.?\d*", path)]
        xs.extend(numbers[0::2])
        ys.extend(numbers[1::2])
    return min(xs), min(ys), max(xs), max(ys)


def stroke_centroid(paths: list[str]) -> tuple[float, float]:
    """Length-weighted centre of the rendered contour ink.

    The contour silhouette is intentionally asymmetric. Centring its control
    point bounds leaves the visible stroke low and right, so this measures the
    midpoints people actually see instead.
    """
    weighted_x = 0.0
    weighted_y = 0.0
    total = 0.0
    for path in paths:
        points = flatten(path)
        for start, end in zip(points, points[1:]):
            length = math.hypot(end[0] - start[0], end[1] - start[1])
            weighted_x += ((start[0] + end[0]) / 2) * length
            weighted_y += ((start[1] + end[1]) / 2) * length
            total += length
    if total == 0:
        raise ValueError("contour artwork has no measurable stroke")
    return weighted_x / total, weighted_y / total


def render(
    size: int, contours: list[str], logical_size: int | None = None
) -> Image.Image:
    """Draw the compact mark at one packaged icon's pixel and logical size."""
    scale = SUPERSAMPLE
    canvas = size * scale
    logical = logical_size or size
    density = size / logical

    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    inset = canvas * INSET
    square = canvas - inset * 2
    draw_tile(image, inset, square)

    mark_side = square * MARK
    used = contours[:rings_for_size(logical)]

    x0, y0, x1, y1 = bounds(used)
    art = max(x1 - x0, y1 - y0)
    factor = mark_side / art

    # Centre the visible stroke mass, not the 360 px source sheet or the cubic
    # control-point bounds. The shape is asymmetric, so mathematical box
    # centring reads visibly low and right at Dock size.
    cx, cy = stroke_centroid(used)
    offset_x = canvas / 2 - cx * factor
    offset_y = canvas / 2 - cy * factor

    logical_mark = (mark_side / scale) / density
    width = max(1, round(target_stroke(logical_mark) * density * scale))

    for path in used:
        points = [
            (x * factor + offset_x, y * factor + offset_y) for x, y in flatten(path)
        ]
        # ImageDraw constructs a wide polyline from individual segment quads.
        # At icon-master scale their joins can leave tiny dark wedges, so seal
        # every sampled join with the same round brush used for the end seam.
        draw.line(points, fill=STROKE, width=width)
        radius = width / 2
        for x, y in points:
            draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=STROKE)

    return image.resize((size, size), Image.LANCZOS)


def write_favicon(contours: list[str]) -> None:
    """The browser tab icon, as SVG.

    Never seen in the shipped application — a Tauri window has no tab bar — but
    the dev server is opened in a browser constantly, and a blank page icon
    beside a real one is a small, permanent papercut. Vector rather than PNG
    because it costs about a kilobyte and never needs a size decision.

    Composed like the app icon, black square and blue contours, rather than as
    bare linework: a favicon sits on browser chrome that may be light or dark,
    and only the version carrying its own background reads on both.
    """
    box = 64.0
    inset = box * 0.03
    square = box - inset * 2

    used = contours[:rings_for_size(16)]
    x0, y0, x1, y1 = bounds(used)
    art = max(x1 - x0, y1 - y0)
    factor = (square * MARK) / art
    cx, cy = stroke_centroid(used)

    paths = "\n".join(f'      <path d="{path}" />' for path in used)
    # The browser rasterises this 64-unit vector directly into a 16 px tab. A
    # 5.2-unit line lands at 1.3 real pixels there instead of a grey hairline.
    stroke = 5.2 / factor

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box:.0f} {box:.0f}" role="img" aria-label="Atticus">
  <rect x="{inset:.2f}" y="{inset:.2f}" width="{square:.2f}" height="{square:.2f}" rx="{square * CORNER:.2f}" fill="{BACKGROUND_HEX}" />
  <g transform="translate({box / 2 - cx * factor:.3f} {box / 2 - cy * factor:.3f}) scale({factor:.5f})">
    <g fill="none" stroke="{STROKE_HEX}" stroke-width="{stroke:.2f}" stroke-linecap="round" stroke-linejoin="round">
{paths}
    </g>
  </g>
</svg>
"""

    public = ROOT / "public"
    public.mkdir(exist_ok=True)
    (public / "favicon.svg").write_text(svg)
    print("  public/favicon.svg")


def write_icns(contours: list[str]) -> None:
    """Pack the per-size PNG renders into a macOS ICNS container."""
    rendered: dict[tuple[int, int], bytes] = {}

    def png(size: int, logical_size: int) -> bytes:
        key = (size, logical_size)
        if key not in rendered:
            output = io.BytesIO()
            render(size, contours, logical_size).save(output, format="PNG")
            rendered[key] = output.getvalue()
        return rendered[key]

    # The duplicate pixel sizes are intentional: ic11–ic14 identify Retina
    # representations, while icp4–ic10 identify their standard-scale peers.
    representations = [
        ("icp4", 16, 16),
        ("icp5", 32, 32),
        ("icp6", 64, 64),
        ("ic07", 128, 128),
        ("ic08", 256, 256),
        ("ic09", 512, 512),
        ("ic10", 1024, 512),
        ("ic11", 32, 16),
        ("ic12", 64, 32),
        ("ic13", 256, 128),
        ("ic14", 512, 256),
    ]
    chunks = [
        kind.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload
        for kind, size, logical_size in representations
        for payload in [png(size, logical_size)]
    ]
    body = b"".join(chunks)
    (ICONS / "icon.icns").write_bytes(
        b"icns" + struct.pack(">I", len(body) + 8) + body
    )
    print("  icon.icns")


def main() -> None:
    contours = read_contours()
    ICONS.mkdir(parents=True, exist_ok=True)
    write_favicon(contours)

    # The sizes named in tauri.conf.json, plus the source for everything else.
    for name, size, logical_size in [
        ("32x32.png", 32, 32),
        ("128x128.png", 128, 128),
        ("128x128@2x.png", 256, 128),
        ("icon.png", 1024, 512),
        ("StoreLogo.png", 512, 512),
        ("Square30x30Logo.png", 30, 30),
        ("Square44x44Logo.png", 44, 44),
        ("Square71x71Logo.png", 71, 71),
        ("Square89x89Logo.png", 89, 89),
        ("Square107x107Logo.png", 107, 107),
        ("Square142x142Logo.png", 142, 142),
        ("Square150x150Logo.png", 150, 150),
        ("Square284x284Logo.png", 284, 284),
        ("Square310x310Logo.png", 310, 310),
    ]:
        render(size, contours, logical_size).save(ICONS / name)
        print(f"  {name}")

    # Windows wants every size inside one file. Supply independently rendered
    # frames so Pillow does not shrink the 256 px hairline into every smaller
    # slot — the same failure this generator is designed to avoid for ICNS.
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_frames = {size: render(size, contours, size) for size in ico_sizes}
    ico_frames[256].save(
        ICONS / "icon.ico",
        sizes=[(size, size) for size in ico_sizes],
        append_images=[ico_frames[size] for size in ico_sizes[:-1]],
    )
    print("  icon.ico")

    write_icns(contours)


if __name__ == "__main__":
    main()
