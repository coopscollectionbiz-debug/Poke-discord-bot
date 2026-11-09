"""03-classify.py — read-only. Turns results.json (02-probe-sources.py) into the
inventory CSV + summary.json used by the Markdown reports.

Usage: python -P -E 03-classify.py --results results.json --cache <cache dir> --csv out.csv --summary summary.json
Only extra network access: resolving imgur *page* links from the trackers to i.imgur.com direct files.
"""
import argparse, collections, csv, hashlib, io, json, os, re, urllib.request
from PIL import Image, ImageSequence

ap = argparse.ArgumentParser()
for a in ["results", "cache", "csv", "summary"]:
    ap.add_argument("--" + a, required=True)
ap.add_argument("--manifest", help="optional: write the verified sprite source manifest (JSON) used by tools/import-sprites.mjs")
args = ap.parse_args()
R = json.load(open(args.results, encoding="utf8"))
F, E = R["files"], R["entries"]
SD = "https://play.pokemonshowdown.com/sprites"
PA_RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/"
UA = "coopbot-sprite-audit/1.0 (read-only audit)"

def toid(s):
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("é", "e"))

def pixel_style(r):
    # BW / community gen5-style: hard-edged pixel art, small palette. Downscaled renders / HOME art:
    # thousands of colours and soft alpha. 64 colours allows multi-palette sprites (e.g. Terapagos-Stellar).
    return (r["alphaLevels"] <= 2 and r["maxColors"] <= 128) or r["maxColors"] <= 64

def inspect_bytes(raw):
    out = {"ok": False, "bytes": len(raw), "sha1": hashlib.sha1(raw).hexdigest()}
    try:
        im = Image.open(io.BytesIO(raw)); out.update(format=im.format, size=f"{im.width}x{im.height}", loop=im.info.get("loop"))
        hs, n, ms, mc, al = set(), 0, 0, 0, set()
        for fr in ImageSequence.Iterator(im):
            n += 1; ms += fr.info.get("duration", 0) or 0
            rgba = fr.convert("RGBA"); hs.add(hashlib.md5(rgba.tobytes()).digest())
            if n <= 3 or n % 10 == 0:
                cols = rgba.getcolors(1 << 16) or []
                mc = max(mc, sum(1 for c, p in cols if p[3])); al |= {p[3] for c, p in cols}
        out.update(frames=n, uniqueFrames=len(hs), totalMs=ms, maxColors=mc, alphaLevels=len(al), animated=len(hs) > 1, ok=True)
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    return out

# Resolve imgur page links (tracker cells sometimes hold https://imgur.com/<id> rather than a file).
for u, r in list(F.items()):
    m = re.match(r"https?://imgur\.com/(\w+)$", u)
    if m and not r.get("ok"):
        for ext in ("gif", "png"):
            try:
                req = urllib.request.Request(f"https://i.imgur.com/{m.group(1)}.{ext}", headers={"User-Agent": UA})
                raw = urllib.request.urlopen(req, timeout=30).read()
                res = inspect_bytes(raw)
                if res["ok"]:
                    res["resolvedFrom"] = u; res["resolvedUrl"] = f"https://i.imgur.com/{m.group(1)}.{ext}"; res["http"] = 200
                    F[u] = res
                    break
            except Exception as e:
                F[u] = {**r, "error": f"{r.get('error')} | i.imgur.com: {type(e).__name__}"}

for r in F.values():
    if r.get("ok"):
        r["pixelStyle"] = pixel_style(r)

def f(url):
    return F.get(url) if url else None

def good_anim(res):
    return bool(res and res.get("ok") and res.get("animated") and res.get("pixelStyle"))

def good_static(res):
    return bool(res and res.get("ok") and res.get("pixelStyle"))

SRC_LABEL = {"sd": "Pokémon Showdown gen5ani (Smogon BW-style project)", "pa": "PokéAPI sprites black-white/animated (mirror of Smogon project)",
             "sm": "Smogon tracker attachment (unpublished)", "sds": "Pokémon Showdown gen5 (static)", "pas": "PokéAPI black-white (static)"}
PROJECT = {6: "Smogon X/Y Sprite Project (lead Layell)", 7: "Smogon Sun/Moon Sprite Project (lead Layell / leParagon)",
           8: "Smogon Sprite Project Gen 8+ (lead G.E.Z.; leParagon)", 9: "Smogon Sprite Project Gen 8+ (lead G.E.Z.; leParagon)"}

rows, stats = [], []
manifest = []
def asset(pick, kind):
    if not pick: return None
    s_, u, res = pick
    return {"url": res.get("resolvedUrl") or u, "source": s_, "kind": kind, "sha1": res["sha1"], "bytes": res["bytes"],
            "format": res["format"], "size": res["size"], "frames": res.get("frames", 1), "uniqueFrames": res.get("uniqueFrames", 1),
            "maxColors": res["maxColors"], "alphaLevels": res["alphaLevels"]}
mirror = collections.Counter()
for e in E:
    sid, sd, pa, sh = e["spriteId"], e["sd"], e["pa"], e.get("sheet", {})
    anim_sheet = sh.get("anim", {})
    cands = {}
    for var, sdf, pak, shk in (("front", "gen5ani", "bwAni", "front"), ("shiny", "gen5ani-shiny", "bwAniShiny", "shiny"),
                               ("back", "gen5ani-back", "bwAniBack", "back"), ("backShiny", "gen5ani-back-shiny", "bwAniBackShiny", "backShiny")):
        lst = []
        if sd.get(sdf): lst.append(("sd", f"{SD}/{sdf}/{sd[sdf]}"))
        if pa.get(pak): lst.append(("pa", PA_RAW + pa[pak]))
        u = anim_sheet.get(shk)
        if u and u.startswith("http") and u in F: lst.append(("sm", u))
        cands[var] = lst
    # mirror check (front): Showdown vs PokéAPI
    sdu = next((u for s, u in cands["front"] if s == "sd"), None); pau = next((u for s, u in cands["front"] if s == "pa"), None)
    if sdu and pau and f(sdu) and f(pau) and f(sdu).get("ok") and f(pau).get("ok"):
        mirror["identical" if f(sdu)["sha1"] == f(pau)["sha1"] else "differs"] += 1
    elif sdu and not pau: mirror["showdown-only"] += 1
    elif pau and not sdu: mirror["pokeapi-only"] += 1

    def tracker_mismatch(u):
        # Tracker cells are hand-edited; reject links whose attachment name names another Pokémon/form.
        m = re.search(r"/attachments/([a-z0-9_]+)-(?:gif|png)", u)
        if not m: return None
        fn = m.group(1)
        num = re.match(r"(\d+)", fn)
        if num and int(num.group(1)) != e["num"]: return f"tracker link file '{fn}' is for dex #{int(num.group(1))}"
        if not num and toid(e["baseSpecies"]) not in fn.replace("_", ""): return f"tracker link file '{fn}' names a different Pokémon"
        if re.search(r"_g(s|b|sb)?$", fn) and e["category"] != "gigantamax": return f"tracker link file '{fn}' is a Gigantamax sprite"
        return None

    def pick(var, ref_sha=None):
        best, fails = None, []
        for s, u in cands[var]:
            if s == "sm" and tracker_mismatch(u):
                fails.append(f"sm:{tracker_mismatch(u)}"); continue
            res = f(u)
            if good_anim(res) and (ref_sha is None or res["sha1"] != ref_sha):
                if best is None: best = (s, u, res)
            elif res is not None:
                why = res.get("error") or ("not animated" if res.get("ok") and not res.get("animated") else "fails pixel-art check" if res.get("ok") and not res.get("pixelStyle") else "identical to normal sprite (not a real shiny)" if res.get("ok") else "unreadable")
                fails.append(f"{s}:{why}")
        return best, fails

    front, ffails = pick("front")
    shiny, sfails = pick("shiny", front[2]["sha1"] if front else None)
    back, _ = pick("back")
    backs, _ = pick("backShiny", back[2]["sha1"] if back else None)
    # static
    st_c = [("sds", f"{SD}/gen5/{sd['gen5']}")] if sd.get("gen5") else []
    if pa.get("bwStatic"): st_c.append(("pas", PA_RAW + pa["bwStatic"]))
    sts_c = [("sds", f"{SD}/gen5-shiny/{sd['gen5-shiny']}")] if sd.get("gen5-shiny") else []
    if pa.get("bwStaticShiny"): sts_c.append(("pas", PA_RAW + pa["bwStaticShiny"]))
    static = next(((s, u, f(u)) for s, u in st_c if good_static(f(u))), None)
    static_rejected = [s for s, u in st_c if f(u) and f(u).get("ok") and not f(u).get("pixelStyle")]
    # Prefer the shiny from the same source as the static normal (same drawing, recoloured).
    if static: sts_c.sort(key=lambda c: c[0] != static[0])
    statics = next(((s, u, f(u)) for s, u in sts_c if good_static(f(u)) and (not static or f(u)["sha1"] != static[2]["sha1"])), None)
    if static and statics and statics[0] != static[0]:
        # Switch the normal to the shiny's source when that source has a valid normal too.
        alt = next(((s, u, f(u)) for s, u in st_c if s == statics[0] and good_static(f(u)) and f(u)["sha1"] != statics[2]["sha1"]), None)
        if alt: static = alt
    artwork = bool(pa.get("artwork"))
    render3d = bool(sd.get("dex") or sd.get("home") or pa.get("home"))
    ani3d = bool(sd.get("ani"))

    published_front = front and front[0] in ("sd", "pa")
    published_shiny = shiny and shiny[0] in ("sd", "pa")
    if published_front and published_shiny: cls = "A"
    elif front: cls = "B"
    elif ffails and any("unreadable" in x or "Error" in x for x in ffails): cls = "U"
    elif static: cls = "C"
    elif artwork or render3d: cls = "D"
    else: cls = "E"

    missing = []
    if not front: missing.append("animated front")
    if not shiny: missing.append("animated shiny")
    if not back: missing.append("animated back")
    if not backs: missing.append("animated shiny back")
    if not static: missing.append("static front")
    if not statics: missing.append("static shiny")
    if front and front[0] == "sm": missing.append("(front only on Smogon tracker — not published/QC unknown)")

    if cls == "A":
        both = sdu and pau and f(sdu) and f(pau) and f(sdu).get("sha1") == f(pau).get("sha1")
        conf = "high" if both or front[0] == "sd" else "medium"
    elif cls == "B": conf = "medium" if published_front else "low"
    elif cls in ("C", "D"): conf = "high"
    elif cls == "E": conf = "medium"
    else: conf = "low"

    is_base = e["kind"] == "species"
    if cls == "A": elig = "Phase 1 — animated + animated shiny" if is_base else "Forms not supported yet — asset ready"
    elif cls == "B": elig = ("Phase 2 — animated, shiny falls back to static/normal" if published_front else "Phase 2 — after tracker sprite is published") if is_base else "Forms not supported yet — partial"
    elif cls == "C": elig = "Phase 3 — static 2D only" if is_base else "Forms not supported yet — static only"
    else: elig = "Hold — no pixel-art sprite" if is_base else "Not recommended"

    pf = front or (static and (static[0], static[1], static[2])) or None
    fres = pf[2] if pf else None
    alt = None
    if front:
        alts = [u for s, u in cands["front"] if u != front[1] and good_anim(f(u))]
        alt = alts[0] if alts else None
    elif static:
        alts = [u for s, u in st_c if u != static[1] and good_static(f(u))]
        alt = alts[0] if alts else None
    artist = anim_sheet.get("artist") if front else (sh.get("static", {}).get("artist") if static else "")
    gen_for_project = e["formGen"] if e["kind"] != "species" else e["speciesGen"]
    lic = "Official artwork © Nintendo/Creatures/GAME FREAK (fallback only)" if cls in ("D",) else \
          f"{PROJECT.get(max(6, gen_for_project), PROJECT[8])}; credit spriter/project; non-profit use only" if cls in ("A", "B", "C", "U") else "n/a"
    if pf and gen_for_project == 6: lic += "; X/Y project also asks for notice to Layell + credit page, no redistribution"
    if artist: lic += f"; tracker credit: {artist}"

    yn = lambda x: "yes" if x else "no"
    row = {
        "national_dex_id": e["num"], "pokemon_name": e["name"], "generation": e["speciesGen"],
        "form_identifier": sid, "base_or_form": "base species" if is_base else f"form ({e['category']})",
        "normal_animated_2d": yn(front), "shiny_animated_2d": yn(shiny), "back_animated_2d": yn(back), "shiny_back_animated_2d": yn(backs),
        "normal_static_2d": yn(static), "shiny_static_2d": yn(statics), "artwork_fallback": yn(artwork),
        "classification": cls,
        "preferred_source": SRC_LABEL[pf[0]] if pf else ("PokéAPI official-artwork" if artwork else ""),
        "preferred_url": (fres.get("resolvedUrl") or pf[1]) if pf else (PA_RAW + pa["artwork"] if artwork else ""),
        "alternate_source": alt or "",
        "file_format": fres.get("format", "") if fres else "",
        "frame_count": fres.get("frames", "") if fres else "",
        "dimensions": fres.get("size", "") if fres else "",
        "file_verification": (f"OK: decoded {fres['frames']} frames ({fres['uniqueFrames']} unique), {fres['totalMs']} ms/loop, loop={fres.get('loop')}, {fres['bytes']} B" if fres and fres.get("frames", 0) > 1 else f"OK: static {fres['format']}, {fres['bytes']} B" if fres else ("artwork present in PokéAPI tree (not downloaded)" if artwork else "no file")) + (("; rejected candidates: " + ", ".join(ffails)) if ffails else "") + (("; static rejected (render placeholder): " + ",".join(static_rejected)) if static_rejected else ""),
        "art_style_verification": (f"2D pixel art: {fres['maxColors']} colours, {fres['alphaLevels']} alpha levels" if fres else "") + ("; 3D-model GIF exists on Showdown ani (rejected for style)" if ani3d else ""),
        "attribution_licensing": lic,
        "confidence": conf,
        "recommended_bot_eligibility": elig,
        "missing_assets": "; ".join(missing),
    }
    rows.append(row)
    normal_asset = asset(front, "animated") or asset(static, "static")
    shiny_asset = asset(shiny, "animated") or asset(statics, "static")
    if normal_asset and shiny_asset and normal_asset["sha1"] == shiny_asset["sha1"]:
        shiny_asset = None  # never let the normal sprite stand in for a shiny
    manifest.append({"dex": e["num"], "name": e["name"], "spriteId": sid, "kind": e["kind"], "category": e["category"],
                     "classification": cls, "normal": normal_asset, "shiny": shiny_asset,
                     "credit": {"project": PROJECT.get(max(6, gen_for_project), PROJECT[8]), "artist": artist or None,
                                "trackerQc": (anim_sheet.get("qc") if front else sh.get("static", {}).get("qc")) or None}})
    stats.append({**row, "category": e["category"], "kind": e["kind"], "legendary": e["legendary"], "mythical": e["mythical"], "tags": e["tags"],
                  "frontSrc": front[0] if front else None, "shinySrc": shiny[0] if shiny else None, "ani3d": ani3d, "render3d": render3d,
                  "staticSrc": static[0] if static else None, "staticRejected": static_rejected, "bytes": fres.get("bytes") if fres else None,
                  "totalMs": fres.get("totalMs") if fres else None})

if args.manifest:
    json.dump({"generatedFrom": "docs/audits/pokemon-gen6-9 probe run " + R["generatedAt"], "rules": "normal: verified animated BW-style front, else verified static BW-style front; shiny: verified animated shiny distinct from normal, else verified static shiny distinct from the static normal; 3D sources never eligible",
               "entries": manifest}, open(args.manifest, "w", encoding="utf8"), indent=1, ensure_ascii=False)
with open(args.csv, "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
json.dump({"rows": stats, "mirror": mirror, "listingCounts": R["listingCounts"], "unmatchedSheetRows": R["unmatchedSheetRows"],
           "probeGeneratedAt": R["generatedAt"]}, open(args.summary, "w", encoding="utf8"), indent=1, default=str)
c = collections.Counter((r["generation"], r["classification"]) for r in stats if r["kind"] == "species")
for g in (6, 7, 8, 9):
    print(g, {k: c[(g, k)] for k in "ABCDEU"})
print("mirror", dict(mirror))
print("forms", collections.Counter(r["classification"] for r in stats if r["kind"] != "species"))
