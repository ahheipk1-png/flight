"""Prepares the SmartFlighter brand PNGs for the frontend.

The spec (Plan/SMARTFLIGHTER_FINAL_SPEC.md) calls for three transparent
assets, but the ChatGPT exports we actually have are NOT transparent:
the primary logo sits on a near-black radial-glow background, and the
searching/complete illustrations sit on a soft grey/white gradient.

This script:
  1. Copies/renames the two illustrations to their canonical spec names,
     resized and re-encoded (PNG + WebP) for the web -- they keep their
     gradient backgrounds and ship inside a card, per the plan.
  2. Extracts the plane mascot from the logo art with rembg (a trained
     salient-object segmenter) for the header/favicon. A plain
     color-distance flood-fill was tried first and rejected: the source
     background is a genuine gradient overlapping the character's own
     white highlights, so no fixed threshold separated them cleanly. A
     learned segmenter doesn't have that problem -- it identifies the
     mascot semantically rather than by color distance, and as a bonus
     it naturally drops the "SmartFlighter" wordmark (treated as
     background/typography, not the salient subject), which is exactly
     what's wanted since the header already renders that text live next
     to the mark. The crop uses only high-alpha (>200) pixels for its
     bounding box so the mascot's own faint motion-swoosh trail doesn't
     widen it into an off-center rectangle.

Run this script, then LOOK at the output brand/ folder before trusting
it -- if the extraction ever looks wrong (rembg model change, different
source art, etc.), the frontend's documented fallback is a text-only
"SmartFlighter" header.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw
from rembg import remove

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


def _extract_mascot() -> Image.Image:
    """Runs rembg on the source logo and returns the mascot cropped to a
    padded square canvas, transparent background, no distortion. Bbox is
    computed from high-alpha pixels only (excludes the faint motion-swoosh
    trail) so the mascot ends up centered rather than off to one side.
    """
    src = Image.open(LOGO_SRC).convert("RGBA")
    extracted = remove(src)

    alpha = extracted.split()[-1]
    solid_mask = alpha.point(lambda p: 255 if p > 200 else 0)
    bbox = solid_mask.getbbox()
    if bbox is None:
        raise RuntimeError("rembg extraction produced an empty mask -- inspect the source art / model output")
    cropped = extracted.crop(bbox)

    side = round(max(cropped.size) * 1.06)  # ~6% padding
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2), cropped)
    return canvas


def save_brand_mark_and_favicons() -> None:
    mascot = _extract_mascot()

    # Transparent version for the in-page header (sits inline next to the
    # "SmartFlighter" wordmark on the light page background).
    header_mark = mascot.resize((512, 512), Image.LANCZOS)
    header_mark.save(OUT_DIR / "logo-mark.png")
    print(f"  logo-mark.png (rembg-extracted, transparent, {mascot.size} source)")

    # Solid-backed versions for browser tab / home-screen icons, where a
    # transparent icon would be invisible against a dark browser chrome.
    for size in (32, 180, 512):
        backing = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(backing).rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=round(size * 0.22), fill=BRAND_BLUE)
        # Mascot fills ~78% of the backing so it isn't edge-to-edge.
        inner = round(size * 0.78)
        resized_mascot = mascot.resize((inner, inner), Image.LANCZOS)
        offset = (size - inner) // 2
        backing.paste(resized_mascot, (offset, offset), resized_mascot)
        backing.save(OUT_DIR / f"icon-{size}.png")
        print(f"  icon-{size}.png")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Processing illustrations...")
    process_illustrations()

    print("Drawing brand mark + favicons...")
    save_brand_mark_and_favicons()


if __name__ == "__main__":
    main()
