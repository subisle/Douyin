#!/usr/bin/env python3
"""Offline PSD -> poster assets sync (方案 A).

Runtime never reads PSD. This script regenerates:
  - assets/posters/*-meta.json
  - assets/posters/*-plate.png / *-full.png
  - public/posters/*.png
  - assets/posters/layouts.json
  - src/components/desktop/poster-board-layout.ts

Requires: psd-tools + Pillow (use .codex-temp/psd-venv if needed).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "posters"
PUBLIC = ROOT / "public" / "posters"
LAYOUT_TS = ROOT / "src" / "components" / "desktop" / "poster-board-layout.ts"

DEFAULT_JOBS = [
    {
        "id": "male-1-40",
        "label": "男团 1-40",
        "psd": ROOT / "references" / "男团1-40.psd",
        "rank_start": 1,
        "rank_end": 40,
        "with_avatars": True,
    },
    {
        "id": "male-41-90",
        "label": "男团 41-90",
        "psd": ROOT / "references" / "男团41-90.psd",
        "rank_start": 41,
        "rank_end": 90,
        "with_avatars": False,
    },
]

# Photoshop CSS export used base 17 for Top, while engine FontSize stays ~23.978.
# Keep that mapping so SVG stage matches the user's PSD-exported CSS.
NAME_BASE_FONT = 23.978
TOP_BASE_FONT = 17.0


def ensure_deps():
    try:
        from psd_tools import PSDImage  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError as e:
        print(
            "缺少依赖。请先安装：\n"
            f"  {sys.executable} -m pip install psd-tools pillow\n"
            f"原始错误: {e}",
            file=sys.stderr,
        )
        raise SystemExit(1)


def to_list(obj: Any) -> list[Any]:
    if obj is None:
        return []
    if isinstance(obj, (list, tuple)):
        return list(obj)
    try:
        return list(obj)
    except TypeError:
        return [obj]


def safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def extract_font_size(layer) -> float:
    try:
        eng = layer.engine_dict
        runs = eng["StyleRun"]["RunArray"]
        for run in to_list(runs):
            data = run["StyleSheet"]["StyleSheetData"]
            if "FontSize" in data:
                return safe_float(data["FontSize"], NAME_BASE_FONT)
    except Exception:
        pass
    return NAME_BASE_FONT


def extract_fill_color(layer) -> str:
    try:
        eng = layer.engine_dict
        runs = eng["StyleRun"]["RunArray"]
        for run in to_list(runs):
            data = run["StyleSheet"]["StyleSheetData"]
            if "FillColor" in data:
                return str(data["FillColor"])
    except Exception:
        pass
    return "{'Type': 1, 'Values': [1.0, 1.0, 1.0, 1.0]}"


def extract_tracking(layer) -> float:
    try:
        eng = layer.engine_dict
        runs = eng["StyleRun"]["RunArray"]
        for run in to_list(runs):
            data = run["StyleSheet"]["StyleSheetData"]
            if "Tracking" in data:
                return safe_float(data["Tracking"], 0.0)
    except Exception:
        pass
    return 0.0


def extract_faux_bold(layer) -> float:
    try:
        eng = layer.engine_dict
        runs = eng["StyleRun"]["RunArray"]
        for run in to_list(runs):
            data = run["StyleSheet"]["StyleSheetData"]
            if "FauxBold" in data:
                return 1.0 if bool(data["FauxBold"]) else 0.0
    except Exception:
        pass
    return 0.0


def extract_fonts(layer) -> str:
    try:
        rd = layer.resource_dict
        fonts = rd.get("FontSet") if hasattr(rd, "get") else None
        if fonts is not None:
            return str(list(fonts))
    except Exception:
        pass
    return "[]"


def extract_style_sheet(layer) -> str:
    try:
        eng = layer.engine_dict
        runs = eng["StyleRun"]["RunArray"]
        for run in to_list(runs):
            data = run["StyleSheet"]["StyleSheetData"]
            return str(dict(data))
    except Exception:
        pass
    return "{}"


def extract_paragraph(layer) -> str:
    try:
        eng = layer.engine_dict
        return str(dict(eng.get("ParagraphRun", {})))
    except Exception:
        return "{}"


def parse_rank_name(layer_name: str) -> int | None:
    name = str(layer_name).strip()
    if re.fullmatch(r"\d+", name):
        return int(name)
    m = re.fullmatch(r"[Tt]op\s*(\d+)", name)
    if m:
        return int(m.group(1))
    return None


def sample_name(text: str, kind: str, rank: int) -> str:
    raw = (text or "").replace("\r", "").replace("\n", "").strip()
    if not raw:
        return ""
    if kind == "top":
        # "Top1:浩鸣" / "Top2:狼澈"
        m = re.match(rf"Top\s*{rank}\s*[:：]\s*(.+)$", raw, re.I)
        if m:
            return m.group(1).strip()
        if ":" in raw:
            return raw.split(":", 1)[1].strip()
        if "：" in raw:
            return raw.split("：", 1)[1].strip()
    return raw


def estimate_bbox_from_transform(tx: float, ty: float, sx: float, sy: float, text: str, base: float) -> list[int]:
    # Approximate glyph box when PSD bbox is empty (blank text layers).
    char_w = base * 0.95
    w = max(40.0, len(text or "占位") * char_w * sx)
    h = max(24.0, base * 1.2 * sy)
    x0 = int(round(tx - 2))
    y0 = int(round(ty - h * 0.85))
    x1 = int(round(x0 + w))
    y1 = int(round(y0 + h))
    return [x0, y0, x1, y1]


def layer_transform(layer) -> list[float]:
    try:
        t = list(layer.transform)
        if len(t) >= 6:
            return [float(t[0]), float(t[1]), float(t[2]), float(t[3]), float(t[4]), float(t[5])]
    except Exception:
        pass
    return [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]


def hide_dynamic_layers(psd) -> int:
    """Hide text + smartobject layers so composite becomes a blank plate."""
    n = 0
    for layer in psd.descendants():
        kind = getattr(layer, "kind", None)
        if kind in ("type", "smartobject"):
            if layer.visible:
                layer.visible = False
                n += 1
    return n


def composite_png(psd, out_path: Path) -> None:
    from PIL import Image

    img = psd.composite(force=True)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="PNG", optimize=True)


@dataclass
class JobResult:
    id: str
    label: str
    width: int
    height: int
    rank_start: int
    rank_end: int
    slots: list[dict[str, Any]]
    avatar_slots: list[dict[str, Any]]
    image: str


def process_job(job: dict[str, Any], skip_images: bool = False) -> JobResult:
    from psd_tools import PSDImage

    psd_path: Path = job["psd"]
    if not psd_path.exists():
        raise FileNotFoundError(
            f"PSD 不存在: {psd_path}；请通过 --psd-1-40/--psd-41-90 指定路径"
        )

    print(f"[open] {job['id']} <- {psd_path} ({psd_path.stat().st_size / 1024 / 1024:.1f} MB)")
    psd = PSDImage.open(str(psd_path))
    width, height = int(psd.width), int(psd.height)

    text_layers: list[Any] = []
    smart_layers: list[Any] = []
    for layer in psd.descendants():
        kind = getattr(layer, "kind", None)
        if kind == "type":
            text_layers.append(layer)
        elif kind == "smartobject":
            smart_layers.append(layer)

    slots_meta: list[dict[str, Any]] = []
    styles: list[dict[str, Any]] = []
    layout_slots: list[dict[str, Any]] = []

    for layer in text_layers:
        rank = parse_rank_name(layer.name)
        if rank is None:
            continue
        if rank < job["rank_start"] or rank > job["rank_end"]:
            continue

        text = (layer.text or "").replace("\r", "").replace("\n", "")
        kind = "top" if rank <= 3 and job["id"] == "male-1-40" else "name"
        # 41-90 没有 top 台
        if job["id"] != "male-1-40":
            kind = "name"

        transform = layer_transform(layer)
        sx, sy, tx, ty = transform[0], transform[3], transform[4], transform[5]
        engine_font = extract_font_size(layer)
        base_font = TOP_BASE_FONT if kind == "top" else NAME_BASE_FONT
        # Prefer engine size for names; tops force CSS base 17.
        if kind == "name":
            base_font = round(engine_font, 3) if engine_font else NAME_BASE_FONT
            if abs(base_font - NAME_BASE_FONT) < 0.05:
                base_font = NAME_BASE_FONT

        bbox = list(layer.bbox) if layer.bbox is not None else [0, 0, 0, 0]
        if not bbox or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
            sample = sample_name(text, kind, rank) or "占位"
            bbox = estimate_bbox_from_transform(tx, ty, sx, sy, sample, base_font)

        x0, y0, x1, y1 = [int(round(v)) for v in bbox]
        w = max(0, x1 - x0)
        h = max(0, y1 - y0)
        cx = x0 + w / 2
        cy = y0 + h / 2
        sample = sample_name(text, kind, rank)
        effective = base_font * sx

        slot = {
            "layer": str(layer.name),
            "rank": rank,
            "kind": kind,
            "sampleText": sample,
            "bbox": [x0, y0, x1, y1],
            "center": [cx, cy],
            "fontSize": engine_font,
            "fillColor": extract_fill_color(layer),
            "tracking": extract_tracking(layer),
            "fauxBold": extract_faux_bold(layer),
            "fonts": extract_fonts(layer),
            "transform": transform,
        }
        slots_meta.append(slot)

        styles.append(
            {
                "name": str(layer.name),
                "text": text,
                "bbox": [x0, y0, x1, y1],
                "transform": transform,
                "fontSize": engine_font,
                "fillColor": extract_fill_color(layer),
                "tracking": extract_tracking(layer),
                "fauxBold": extract_faux_bold(layer),
                "fontIndex": 0.0,
                "styleSheetData": extract_style_sheet(layer),
                "paragraph": extract_paragraph(layer),
                "fonts": extract_fonts(layer),
            }
        )

        layout_slots.append(
            {
                "rank": rank,
                "kind": kind,
                "x": x0,
                "y": y0,
                "w": w,
                "h": h,
                "cx": cx,
                "cy": cy,
                "fontSize": round(effective, 4),
                "baseFontSize": base_font,
                "sx": sx,
                "sy": sy,
                "tx": tx,
                "ty": ty,
                "sample": sample,
                "empty": not bool(sample),
            }
        )

    # Ensure every rank in range exists (PSD may omit blanks inconsistently)
    have = {s["rank"] for s in layout_slots}
    for rank in range(job["rank_start"], job["rank_end"] + 1):
        if rank in have:
            continue
        kind = "top" if rank <= 3 and job["id"] == "male-1-40" else "name"
        base_font = TOP_BASE_FONT if kind == "top" else NAME_BASE_FONT
        layout_slots.append(
            {
                "rank": rank,
                "kind": kind,
                "x": 0,
                "y": 0,
                "w": 0,
                "h": 0,
                "cx": 0.0,
                "cy": 0.0,
                "fontSize": round(base_font * (1.25116804979353 if kind == "name" else 1.5), 4),
                "baseFontSize": base_font,
                "sx": 1.25116804979353 if kind == "name" else 1.5,
                "sy": 1.25116804979353 if kind == "name" else 1.5,
                "tx": 0.0,
                "ty": 0.0,
                "sample": "",
                "empty": True,
            }
        )

    layout_slots.sort(key=lambda s: s["rank"])
    slots_meta.sort(key=lambda s: s["rank"])
    styles.sort(key=lambda s: int(re.sub(r"\D", "", s["name"]) or "0"))

    avatar_slots: list[dict[str, Any]] = []
    if job.get("with_avatars"):
        # Map smartobjects by center-x: left=Top2, mid=Top1, right=Top3
        smarts = []
        for layer in smart_layers:
            l, t, r, b = layer.bbox
            smarts.append(
                {
                    "name": layer.name,
                    "bbox": [int(l), int(t), int(r), int(b)],
                    "cx": (l + r) / 2,
                }
            )
        smarts.sort(key=lambda s: s["cx"])
        rank_order = [2, 1, 3]
        for idx, sm in enumerate(smarts[:3]):
            x0, y0, x1, y1 = sm["bbox"]
            avatar_slots.append(
                {
                    "rank": rank_order[idx] if idx < len(rank_order) else idx + 1,
                    "x": x0,
                    "y": y0,
                    "w": x1 - x0,
                    "h": y1 - y0,
                    "layer": sm["name"],
                }
            )
        avatar_slots.sort(key=lambda s: s["rank"])

    ASSETS.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    try:
        source = str(psd_path.relative_to(ROOT))
    except ValueError:
        source = psd_path.name

    meta = {
        "tag": job["id"],
        "size": [width, height],
        "slots": slots_meta,
        "styles": styles,
        "avatars": avatar_slots,
        "source": source,
    }
    meta_path = ASSETS / f"{job['id']}-meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[meta] {meta_path} slots={len(slots_meta)} avatars={len(avatar_slots)}")

    plate_path = ASSETS / f"{job['id']}-plate.png"
    full_path = ASSETS / f"{job['id']}-full.png"
    public_path = PUBLIC / f"{job['id']}.png"
    assets_publicish = ASSETS / f"{job['id']}.png"

    if not skip_images:
        print(f"[full] composite original -> {full_path.name}")
        # full with all currently visible layers
        composite_png(psd, full_path)

        print(f"[plate] hide type/smartobject then composite -> {plate_path.name}")
        hidden = hide_dynamic_layers(psd)
        print(f"  hidden layers: {hidden}")
        composite_png(psd, plate_path)

        shutil.copy2(plate_path, public_path)
        shutil.copy2(plate_path, assets_publicish)
        print(f"[copy] {public_path}")
    else:
        print("[images] skipped (--skip-images)")

    return JobResult(
        id=job["id"],
        label=job["label"],
        width=width,
        height=height,
        rank_start=job["rank_start"],
        rank_end=job["rank_end"],
        slots=layout_slots,
        avatar_slots=avatar_slots,
        image=f"posters/{job['id']}.png",
    )


def fmt_num(n: float) -> str:
    if abs(n - round(n)) < 1e-9:
        return str(int(round(n)))
    s = f"{n:.12f}".rstrip("0").rstrip(".")
    return s


def write_layouts_json(results: list[JobResult]) -> None:
    data: dict[str, Any] = {}
    for r in results:
        data[r.id] = {
            "id": r.id,
            "label": r.label,
            "width": r.width,
            "height": r.height,
            "image": f"/posters/{r.id}.png",
            "rankStart": r.rank_start,
            "rankEnd": r.rank_end,
            "slots": [
                {
                    "rank": s["rank"],
                    "kind": s["kind"],
                    "x": s["x"],
                    "y": s["y"],
                    "w": s["w"],
                    "h": s["h"],
                    "cx": s["cx"],
                    "cy": s["cy"],
                    "fontSize": s["fontSize"],
                    "baseFontSize": s["baseFontSize"],
                    "sx": s["sx"],
                    "sy": s["sy"],
                    "tx": s["tx"],
                    "ty": s["ty"],
                    "sample": s.get("sample", ""),
                    "empty": s.get("empty", False),
                }
                for s in r.slots
            ],
            "avatarSlots": [
                {"rank": a["rank"], "x": a["x"], "y": a["y"], "w": a["w"], "h": a["h"]}
                for a in r.avatar_slots
            ],
        }
    path = ASSETS / "layouts.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[layouts.json] {path}")


def write_layout_ts(results: list[JobResult]) -> None:
    lines: list[str] = []
    lines.append("/** Auto-derived from PSD templates. Coordinates are in template pixel space.")
    lines.append(" *  文字用 SVG <text> + PSD transform 基线定位（不是 HTML top 盒模型）。")
    lines.append(" *  name: font-size 23.978 * matrix(~1.251168)")
    lines.append(" *  top:  font-size 17 * matrix(Top1~1.76018, Top2/3~1.51305)")
    lines.append(" *  由 scripts/sync-poster-from-psd.py 生成，请勿手改坐标。")
    lines.append(" */")
    lines.append("export type PosterBoardSlot = {")
    lines.append('  rank: number;')
    lines.append('  kind: "top" | "name";')
    lines.append("  x: number;")
    lines.append("  y: number;")
    lines.append("  w: number;")
    lines.append("  h: number;")
    lines.append("  cx: number;")
    lines.append("  cy: number;")
    lines.append("  /** 有效视觉字号（base*sx），仅参考 */")
    lines.append("  fontSize: number;")
    lines.append("  /** PSD/CSS 原始 font-size（未乘 matrix） */")
    lines.append("  baseFontSize: number;")
    lines.append("  sx: number;")
    lines.append("  sy: number;")
    lines.append("  /** PSD transform 平移 = 文本基线原点 */")
    lines.append("  tx: number;")
    lines.append("  ty: number;")
    lines.append("};")
    lines.append("")
    lines.append("/** Top 头像位，用于叠加透明 PNG */")
    lines.append("export type PosterBoardAvatarSlot = {")
    lines.append("  rank: number;")
    lines.append("  x: number;")
    lines.append("  y: number;")
    lines.append("  w: number;")
    lines.append("  h: number;")
    lines.append("};")
    lines.append("")
    lines.append("export type PosterBoardTemplate = {")
    lines.append("  id: string;")
    lines.append("  label: string;")
    lines.append("  width: number;")
    lines.append("  height: number;")
    lines.append("  image: string;")
    lines.append("  rankStart: number;")
    lines.append("  rankEnd: number;")
    lines.append("  slots: PosterBoardSlot[];")
    lines.append("  avatarSlots?: PosterBoardAvatarSlot[];")
    lines.append("};")
    lines.append("")
    lines.append("export const POSTER_BOARD_TEMPLATES: PosterBoardTemplate[] = [")

    for r in results:
        lines.append("  {")
        lines.append(f'    id: "{r.id}",')
        lines.append(f'    label: "{r.label}",')
        lines.append(f"    width: {r.width},")
        lines.append(f"    height: {r.height},")
        lines.append(f'    image: "{r.image}",')
        lines.append(f"    rankStart: {r.rank_start},")
        lines.append(f"    rankEnd: {r.rank_end},")
        lines.append("    slots: [")
        for s in r.slots:
            lines.append(
                "      { "
                f"rank: {s['rank']}, kind: \"{s['kind']}\", "
                f"x: {s['x']}, y: {s['y']}, w: {s['w']}, h: {s['h']}, "
                f"cx: {fmt_num(s['cx'])}, cy: {fmt_num(s['cy'])}, "
                f"fontSize: {fmt_num(s['fontSize'])}, baseFontSize: {fmt_num(s['baseFontSize'])}, "
                f"sx: {fmt_num(s['sx'])}, sy: {fmt_num(s['sy'])}, "
                f"tx: {fmt_num(s['tx'])}, ty: {fmt_num(s['ty'])}"
                " },"
            )
        lines.append("    ],")
        if r.avatar_slots:
            lines.append("    avatarSlots: [")
            lines.append("      // PSD smartobject 位：按中心 x 映射 Top2 / Top1 / Top3")
            for a in r.avatar_slots:
                lines.append(
                    "      { "
                    f"rank: {a['rank']}, x: {a['x']}, y: {a['y']}, w: {a['w']}, h: {a['h']}"
                    " },"
                )
            lines.append("    ],")
        lines.append("  },")

    lines.append("];")
    lines.append("")

    LAYOUT_TS.write_text("\n".join(lines), encoding="utf-8")
    print(f"[layout.ts] {LAYOUT_TS}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="从 PSD 同步海报导出布局与底板")
    p.add_argument("--psd-1-40", type=Path, default=None, help="覆盖 男团1-40.psd 路径")
    p.add_argument("--psd-41-90", type=Path, default=None, help="覆盖 男团41-90.psd 路径")
    p.add_argument("--only", choices=["male-1-40", "male-41-90"], default=None)
    p.add_argument("--skip-images", action="store_true", help="只更新 meta/layout，不重导出 PNG")
    return p.parse_args()


def main() -> None:
    ensure_deps()
    args = parse_args()
    jobs = []
    for job in DEFAULT_JOBS:
        j = dict(job)
        if j["id"] == "male-1-40" and args.psd_1_40:
            j["psd"] = args.psd_1_40
        if j["id"] == "male-41-90" and args.psd_41_90:
            j["psd"] = args.psd_41_90
        if args.only and j["id"] != args.only:
            continue
        jobs.append(j)

    if not jobs:
        raise SystemExit("没有可处理的任务")

    results: list[JobResult] = []
    for job in jobs:
        results.append(process_job(job, skip_images=args.skip_images))

    # If only one job ran, still rewrite layouts with existing other template from current TS? Prefer full both.
    if len(results) == 1 and not args.only:
        pass

    if args.only:
        # Merge with previous layouts.json if present
        prev_path = ASSETS / "layouts.json"
        prev = {}
        if prev_path.exists():
            try:
                prev = json.loads(prev_path.read_text(encoding="utf-8"))
            except Exception:
                prev = {}
        write_layouts_json(results)
        # re-read and merge
        cur = json.loads((ASSETS / "layouts.json").read_text(encoding="utf-8"))
        merged = dict(prev)
        merged.update(cur)
        (ASSETS / "layouts.json").write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
        # For TS, only full rewrite when both present; else rebuild from merged
        rebuild: list[JobResult] = []
        for jid in ("male-1-40", "male-41-90"):
            if jid not in merged:
                continue
            item = merged[jid]
            rebuild.append(
                JobResult(
                    id=item["id"],
                    label=item["label"],
                    width=item["width"],
                    height=item["height"],
                    rank_start=item["rankStart"],
                    rank_end=item["rankEnd"],
                    slots=item["slots"],
                    avatar_slots=item.get("avatarSlots") or [],
                    image=item["image"].lstrip("/") if item["image"].startswith("/") else item["image"],
                )
            )
        # normalize image paths for ts
        for r in rebuild:
            if r.image.startswith("posters/") is False:
                r.image = r.image.replace("/posters/", "posters/")
                if r.image.startswith("/"):
                    r.image = r.image[1:]
        write_layout_ts(rebuild)
    else:
        write_layouts_json(results)
        write_layout_ts(results)

    print("[done] poster sync complete")


if __name__ == "__main__":
    main()
