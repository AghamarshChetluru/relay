"""Build the annotated screenshot assets for the Relay PRD appendix.

Input : assets/raw/*.png   real screenshots of the Android app (captured from the emulator at commit 8a24585, or taken from docs/screenshots/final-polish)
Output: assets/annotated_*.png  the SAME pixels, framed, with numbered markers placed OUTSIDE the UI and thin leader lines to the element explained
        assets/strip_*.png      plain crops of a real screenshot (no annotation) used as secondary evidence

Coordinates below are in pixels of the 1080x2207 app-only screenshots (status bar removed).
Nothing inside the phone UI is redrawn or edited except the leader line and a small target dot.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "assets" / "raw", ROOT / "assets"

MUSTARD, INK, CREAM = (217, 162, 27, 255), (20, 38, 58, 255), (253, 248, 238, 255)
MARGIN, FRAME, RADIUS = 190, 8, 70


def font(size):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/HelveticaNeue.ttc", "/Library/Fonts/Arial Bold.ttf"):
        try:
            return ImageFont.truetype(p, size, index=1 if p.endswith(".ttc") else 0)
        except Exception:
            continue
    return ImageFont.load_default()


def phone(img):
    """Rounded, thinly framed copy of the screenshot on a transparent canvas."""
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), RADIUS, fill=255)
    body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    body.paste(img.convert("RGBA"), (0, 0), mask)
    canvas = Image.new("RGBA", (w + 2 * FRAME, h + 2 * FRAME), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((0, 0, canvas.width - 1, canvas.height - 1), RADIUS + FRAME, fill=INK)
    canvas.alpha_composite(body, (FRAME, FRAME))
    return canvas


def annotate(src, name, marks):
    """marks: list of (number, centre_y, half_height, side): a translucent band marks the explained element; the numbered marker sits outside the phone.
    centre_y / half_height are in screenshot pixels. Nothing is drawn over the text itself except the 28 % band."""
    img = Image.open(RAW / src).convert("RGBA")
    ph = phone(img)
    W, H = ph.width + 2 * MARGIN, ph.height
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((MARGIN + 6, 14, MARGIN + ph.width + 6, ph.height - 2), RADIUS, fill=(20, 38, 58, 60))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    canvas.alpha_composite(ph, (MARGIN, 0))
    # bands first (alpha layer), then lines and markers on top
    bands = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bands)
    x0, x1 = MARGIN + FRAME + 14, MARGIN + FRAME + img.width - 14
    for n, cy, hh, side in marks:
        y = FRAME + cy
        bd.rounded_rectangle((x0, y - hh, x1, y + hh), 16, fill=(217, 162, 27, 72), outline=(217, 162, 27, 235), width=4)
    canvas.alpha_composite(bands)
    d = ImageDraw.Draw(canvas)
    f = font(46)
    last = {"L": -999, "R": -999}
    for n, cy, hh, side in sorted(marks, key=lambda m: m[1]):
        y = FRAME + cy
        my = max(y, last[side] + 112)                                  # keep markers apart vertically
        last[side] = my
        mx = MARGIN // 2 if side == "L" else W - MARGIN // 2
        ex = x0 if side == "L" else x1                                 # band edge the line points at
        d.line([(mx, my), (ex, y)], fill=INK, width=5)
        d.ellipse((ex - 11, y - 11, ex + 11, y + 11), fill=MUSTARD, outline=INK, width=4)
        d.ellipse((mx - 40, my - 40, mx + 40, my + 40), fill=MUSTARD, outline=INK, width=5)
        tw = d.textlength(str(n), font=f)
        d.text((mx - tw / 2, my - 27), str(n), font=f, fill=INK)
    canvas.save(OUT / name)
    print("wrote", name, canvas.size)


def strip(src, name, box):
    im = Image.open(RAW / src).convert("RGBA").crop(box)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), 28, fill=255)
    out = Image.new("RGBA", (im.width + 12, im.height + 12), (0, 0, 0, 0))
    ImageDraw.Draw(out).rounded_rectangle((0, 0, out.width - 1, out.height - 1), 34, fill=INK)
    out.paste(im, (6, 6), mask)
    out.save(OUT / name)
    print("wrote", name, out.size)


if __name__ == "__main__":
    annotate("onboard1_app.png", "annotated_01_onboarding.png", [(1, 468, 72, "L"), (2, 877, 261, "R"), (3, 1216, 58, "L"), (4, 1518, 45, "R")])
    annotate("home_4_phones.png", "annotated_02_home.png", [(1, 83, 52, "R"), (2, 182, 38, "R"), (3, 1075, 195, "L"), (4, 1576, 150, "R")])
    annotate("01_create_urgent_request.png", "annotated_03_request_composer.png", [(1, 1000, 48, "L"), (2, 1322, 55, "L"), (3, 1601, 108, "R"), (4, 1878, 105, "R")])
    annotate("05_missing_person.png", "annotated_04_missing_person.png", [(1, 736, 98, "L"), (2, 1012, 66, "R"), (3, 1279, 90, "L"), (4, 1906, 90, "R")])
    annotate("02_smart_inbox.png", "annotated_05_inbox.png", [(1, 359, 75, "L"), (2, 674, 190, "R"), (3, 1024, 92, "L"), (4, 1491, 100, "R"), (5, 2118, 85, "L")])
    annotate("03_received_request_offer_help.png", "annotated_06_offer_help.png", [(1, 447, 40, "R"), (2, 1161, 30, "L"), (3, 1410, 160, "R"), (4, 1725, 95, "L"), (5, 1974, 110, "R")])
    annotate("04_reply_acknowledgment.png", "annotated_07_reply_ack.png", [(1, 730, 58, "L"), (2, 1288, 66, "R"), (3, 1450, 60, "L"), (4, 1590, 62, "R")])
    annotate("alt_04a_my_activity_status_timeline.png", "annotated_08_my_activity.png", [(1, 728, 36, "R"), (2, 1390, 260, "L"), (3, 1597, 36, "R"), (4, 2118, 85, "L")])

    # secondary strips (plain crops of real screenshots)
    strip("area_sheet_app.png", "strip_area_sheet.png", (0, 810, 1080, 1250))
    strip("android-shade-summary.png", "strip_notification_summary.png", (0, 560, 1080, 800))
    strip("alt_04b_exact_address_shared.png", "strip_address_shared.png", (0, 1384, 1080, 1636))
    strip("alt_05d_missing_sighting_detail.png", "strip_renew_resolve.png", (0, 1816, 1080, 2164))
    strip("05b_photo_validity.png", "strip_photo_validity.png", (0, 1110, 1080, 1570)) if (RAW / "05b_photo_validity.png").exists() else None
