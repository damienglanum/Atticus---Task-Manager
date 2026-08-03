#!/usr/bin/env python3
"""Draws the application icons from the contour mark.

Not part of `npm run verify`, and not run at build time: it writes binary assets
that are checked in. Run it when the mark changes.

    python3 scripts/generate-icons.py

Needs Pillow. Deliberately a generator rather than a hand-exported PNG: the app
icon always uses the same three-contour geometry as the 26 px sidebar mark, then
draws each output size separately so its line weight survives at Dock and
favicon scale. Those renders are packed directly into the multi-resolution
.icns container.

The geometry is read from `src/components/ui/logoContours.ts`, so the icon and
the interface cannot disagree about what the mark is.
"""

from __future__ import annotations

import io
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

# Match the dark sidebar treatment: a black tile with its bright cyan mark.
# Combined with the sidebar's three-contour geometry, this remains distinct at
# the 16–32 px sizes used by browser tabs and the Dock.
BACKGROUND = (11, 12, 13, 255)  # #0b0c0d, the app's near-black
STROKE = (76, 204, 230, 255)  # #4ccce6, dark-theme --color-accent-fg
BACKGROUND_HEX = "#0b0c0d"
STROKE_HEX = "#4ccce6"

# macOS icons are not full-bleed: the artwork sits inside a rounded square with
# a margin, and the system expects that margin to be part of the image.
INSET = 0.10  # of the canvas, each side
CORNER = 0.225  # of the squircle's own side
# The mark's share of the squircle. 0.60 left it looking like a small object in
# a large box beside the other icons in the Dock — the squircle already supplies
# the breathing room that the artwork does not need to supply again.
MARK = 0.82
SIDEBAR_RINGS = 3

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
    if mark_pixels < 28:
        return 1.3
    if mark_pixels < 56:
        return 1.5
    if mark_pixels < 160:
        return 1.6
    return 2.2


def bounds(paths: list[str]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for path in paths:
        numbers = [float(n) for n in re.findall(r"-?\d+\.?\d*", path)]
        xs.extend(numbers[0::2])
        ys.extend(numbers[1::2])
    return min(xs), min(ys), max(xs), max(ys)


def render(size: int, contours: list[str]) -> Image.Image:
    """Draw the sidebar's simplified mark at one packaged-icon size."""
    scale = SUPERSAMPLE
    canvas = size * scale

    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    inset = canvas * INSET
    square = canvas - inset * 2
    draw.rounded_rectangle(
        [inset, inset, inset + square, inset + square],
        radius=square * CORNER,
        fill=BACKGROUND,
    )

    mark_side = square * MARK
    used = contours[:SIDEBAR_RINGS]

    x0, y0, x1, y1 = bounds(used)
    art = max(x1 - x0, y1 - y0)
    factor = mark_side / art

    # Centre the artwork's own bounding box in the squircle, not its canvas: the
    # contours are off-centre on the 360 x 360 sheet they were drawn on.
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    offset_x = canvas / 2 - cx * factor
    offset_y = canvas / 2 - cy * factor

    width = max(1, round(target_stroke(mark_side / scale) * scale))

    for path in used:
        points = [
            (x * factor + offset_x, y * factor + offset_y) for x, y in flatten(path)
        ]
        draw.line(points, fill=STROKE, width=width, joint="curve")
        # `joint="curve"` rounds the corners between segments but leaves the two
        # ends square, and these paths are closed loops. A disc at the seam is
        # cheaper than compositing a second pass.
        radius = width / 2
        sx, sy = points[0]
        draw.ellipse([sx - radius, sy - radius, sx + radius, sy + radius], fill=STROKE)

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

    used = contours[:SIDEBAR_RINGS]
    x0, y0, x1, y1 = bounds(used)
    art = max(x1 - x0, y1 - y0)
    factor = (square * MARK) / art
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    paths = "\n".join(
        f'      <path d="{path}" />' for path in used
    )
    stroke = 2.6 / factor  # ~2.6 px at 64, expressed in the artwork's units

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
    rendered: dict[int, bytes] = {}

    def png(size: int) -> bytes:
        if size not in rendered:
            output = io.BytesIO()
            render(size, contours).save(output, format="PNG")
            rendered[size] = output.getvalue()
        return rendered[size]

    # The duplicate pixel sizes are intentional: ic11–ic14 identify Retina
    # representations, while icp4–ic10 identify their standard-scale peers.
    representations = [
        ("icp4", 16),
        ("icp5", 32),
        ("icp6", 64),
        ("ic07", 128),
        ("ic08", 256),
        ("ic09", 512),
        ("ic10", 1024),
        ("ic11", 32),
        ("ic12", 64),
        ("ic13", 256),
        ("ic14", 512),
    ]
    chunks = [
        kind.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload
        for kind, size in representations
        for payload in [png(size)]
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
    for name, size in [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 1024),
        ("StoreLogo.png", 512),
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
    ]:
        render(size, contours).save(ICONS / name)
        print(f"  {name}")

    # Windows wants every size inside one file.
    render(256, contours).save(
        ICONS / "icon.ico",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("  icon.ico")

    write_icns(contours)


if __name__ == "__main__":
    main()
