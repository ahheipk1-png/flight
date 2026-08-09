"""Prepares the SmartFlighter brand PNGs for the frontend.

The spec (Plan/SMARTFLIGHTER_FINAL_SPEC.md) calls for three transparent
assets, but the ChatGPT exports we actually have are NOT transparent:
the primary logo sits on a near-black radial-glow background, and the
searching/complete illustrations sit on a soft grey/white gradient.

This script:
  1. Copies/renames the two illustrations to their canonical spec names,
     resized and re-encoded (PNG + WebP) for the web -- they keep their
     gradient backgrounds and ship inside a card, per the plan.
  2. Draws a small, clean, on-brand paper-plane mark programmatically for
     the header/favicon, rather than trying to key it out of the source
     art. A flood-fill extraction was tried first and rejected: the
     background is a genuine gradient (dark corners to near-white
     center) that overlaps the character's own white highlight areas, so
     no single color-distance threshold separates them without either
     ragged edges or eating into the plane itself -- see git history /
     PR discussion if you want to see that attempt. A few crisp polygons
     are more reliable than fighting that gradient.

Run this script, then LOOK at the output brand/ folder before trusting
it -- if the programmatic mark ever looks wrong, the frontend's
documented fallback is a text-only "SmartFlighter" header.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "Plan"
OUT_DIR = REPO_ROOT / "frontend" / "public" / "brand"

SEARCHING_SRC = SRC_DIR / "ChatGPT Image Aug 9, 2026, 12_43_12 AM.png"
COMPLETE_SRC = SRC_DIR / "ChatGPT Image Aug 9, 2026, 12_40_10 AM.png"
LOGO_SRC = SRC_DIR / "ChatGPT Image Aug 9, 2026, 12_39_34 AM.png"

MAX_ILLUSTRATION_WIDTH = 1260

# Sampled from the source artwork.
BRAND_BLUE = (33, 150, 243, 255)
BRAND_NAVY = (27, 58, 107, 255)


def _resize_max_width(img: Image.Image, max_width: int) -> Image.Image:
    if img.width <= max_width:
        return img
    ratio = max_width / img.width
    return img.resize((max_width, round(img.height * ratio)), Image.LANCZOS)


def _save_png_and_webp(img: Image.Image, out_path_no_ext: Path) -> None:
    img.save(out_path_no_ext.with_suffix(".png"), format="PNG", optimize=True)
    img.convert("RGB").save(out_path_no_ext.with_suffix(".webp"), format="WEBP", quality=85)


def process_illustrations() -> None:
    for src, name in [(SEARCHING_SRC, "smartflighter-searching"), (COMPLETE_SRC, "smartflighter-search-complete")]:
        img = Image.open(src).convert("RGBA")
        img = _resize_max_width(img, MAX_ILLUSTRATION_WIDTH)
        _save_png_and_webp(img, OUT_DIR / name)
        print(f"  {name}: {img.width}x{img.height} -> .png + .webp")

    # Keep the original dark-background logo available (e.g. for a future
    # dark hero section); it is NOT used in the light-mode header.
    Image.open(LOGO_SRC).convert("RGBA").save(OUT_DIR / "smartflighter-logo-original.png")


def _paper_plane_polygon(size: int) -> list[tuple[float, float]]:
    """Simple 4-point dart silhouette (nose / top wing / fold-in / tail),
    the same family of shape as common "send/fly" glyphs. Reads clearly
    even at 16-32px, unlike a literal render of the mascot at that size.
    """
    pts = [(0.93, 0.5), (0.08, 0.10), (0.34, 0.5), (0.08, 0.90)]
    return [(x * size, y * size) for x, y in pts]


def draw_plane_mark(size: int = 512, *, transparent_bg: bool) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent_bg else BRAND_BLUE)
    draw = ImageDraw.Draw(canvas)

    if not transparent_bg:
        # Rounded-square favicon backing so it stays legible in a browser
        # tab; radius scales with size.
        draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=round(size * 0.22), fill=BRAND_BLUE)

    margin = size * 0.16
    plane_size = size - 2 * margin
    plane = Image.new("RGBA", (round(plane_size), round(plane_size)), (0, 0, 0, 0))
    plane_draw = ImageDraw.Draw(plane)
    fill = (255, 255, 255, 255) if not transparent_bg else BRAND_BLUE
    plane_draw.polygon(_paper_plane_polygon(round(plane_size)), fill=fill)
    # Fold-crease accent line for a touch of dimension.
    crease_color = BRAND_BLUE if not transparent_bg else BRAND_NAVY
    plane_draw.line(
        [(0.34 * plane_size, 0.5 * plane_size), (0.60 * plane_size, 0.5 * plane_size)],
        fill=crease_color, width=max(1, round(plane_size * 0.03)),
    )

    canvas.paste(plane, (round(margin), round(margin)), plane)
    return canvas


def save_brand_mark_and_favicons() -> None:
    # Transparent version for the in-page header (sits inline next to the
    # "SmartFlighter" wordmark on the light page background).
    header_mark = draw_plane_mark(512, transparent_bg=True)
    header_mark.save(OUT_DIR / "logo-mark.png")
    print("  logo-mark.png (transparent, for the header)")

    # Solid-backed versions for browser tab / home-screen icons, where a
    # transparent icon would be invisible against a dark browser chrome.
    for size in (32, 180, 512):
        draw_plane_mark(size, transparent_bg=False).save(OUT_DIR / f"icon-{size}.png")
        print(f"  icon-{size}.png")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Processing illustrations...")
    process_illustrations()

    print("Drawing brand mark + favicons...")
    save_brand_mark_and_favicons()


if __name__ == "__main__":
    main()
