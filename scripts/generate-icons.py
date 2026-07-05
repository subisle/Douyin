from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
OUT.mkdir(exist_ok=True)


def font(size: int, bold: bool = True):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhbd.ttc",
    ]
    for item in candidates:
        try:
            return ImageFont.truetype(item, size=size, index=1 if bold else 0)
        except Exception:
            continue
    return ImageFont.load_default()


def rounded_rect_mask(size: int, radius: int):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return mask


def make_icon(size: int):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = rounded_rect_mask(size, int(size * 0.23))

    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pix = bg.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (size * 2)
            r = int(16 + 14 * t)
            g = int(84 + 60 * (1 - t))
            b = int(190 + 42 * (1 - abs(t - 0.5) * 2))
            pix[x, y] = (r, g, b, 255)
    bg.putalpha(mask)
    img.alpha_composite(bg)

    draw = ImageDraw.Draw(img)
    pad = int(size * 0.08)
    draw.rounded_rectangle(
        (pad, pad, size - pad, size - pad),
        radius=int(size * 0.18),
        outline=(255, 255, 255, 70),
        width=max(2, size // 64),
    )

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(
        (int(size * 0.08), int(size * 0.03), int(size * 0.92), int(size * 0.68)),
        fill=(255, 255, 255, 34),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.055))
    glow.putalpha(Image.composite(glow.getchannel("A"), Image.new("L", (size, size), 0), mask))
    img.alpha_composite(glow)

    # 数据增长柱形，呼应“主播数据管理”。
    bar_w = max(3, int(size * 0.055))
    base_y = int(size * 0.74)
    start_x = int(size * 0.23)
    heights = [0.16, 0.23, 0.31, 0.42]
    for idx, h in enumerate(heights):
        x = start_x + idx * int(size * 0.105)
        y = base_y - int(size * h)
        draw.rounded_rectangle(
            (x, y, x + bar_w, base_y),
            radius=bar_w // 2,
            fill=(255, 216, 110, 235),
        )

    # 主标识：PZ，避免不同系统中文字体渲染差异导致图标乱码。
    text = "PZ"
    fnt = font(int(size * 0.25), bold=True)
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = int(size * 0.25) - bbox[1] - th / 2
    draw.text((tx + size * 0.008, ty + size * 0.01), text, font=fnt, fill=(0, 0, 0, 48))
    draw.text((tx, ty), text, font=fnt, fill=(255, 255, 255, 248))

    # 右上角光点，缩小尺寸时仍有辨识度。
    draw.ellipse(
        (int(size * 0.68), int(size * 0.16), int(size * 0.81), int(size * 0.29)),
        fill=(255, 230, 145, 245),
    )
    return img


def main():
    base = make_icon(1024)
    base.save(OUT / "icon.png")
    base.save(OUT / "icon-1024.png")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [base.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
    ico_images[-1].save(OUT / "icon.ico", sizes=[(s, s) for s in sizes], append_images=ico_images[:-1])

    icns_sizes = [16, 32, 64, 128, 256, 512, 1024]
    icns_images = [base.resize((s, s), Image.Resampling.LANCZOS) for s in icns_sizes]
    icns_images[-1].save(OUT / "icon.icns", append_images=icns_images[:-1])


if __name__ == "__main__":
    main()
