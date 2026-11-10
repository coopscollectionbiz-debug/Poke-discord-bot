"""02-probe-sources.py — read-only sprite source probe + file inspection.

Inputs (all fetched by the commands documented in SPRITE-AVAILABILITY-AUDIT.md §Reproduce):
  --dex        dex.json from 01-build-dex.mjs
  --listings   dir with Showdown directory listings  ls_<folder>.html
  --tree       PokeAPI/sprites `git ls-tree -r --name-only HEAD` output
  --pokeapi-csv dir with PokeAPI pokemon.csv
  --sheets     dir with tracker CSV exports g{6,7,8,9}_{anim,static}.csv
  --cache      download cache dir (files are only ever written here)
  --out        results.json

Nothing is uploaded, posted or modified anywhere. Only HTTP GETs of public files.
Run with:  python -P -E 02-probe-sources.py ...   (Pillow required)
"""
import argparse, concurrent.futures as cf, csv, hashlib, html, io, json, os, re, sys, time, urllib.request
from PIL import Image, ImageSequence

UA = "coopbot-sprite-audit/1.0 (read-only audit; contact via GitHub coopscollectionbiz-debug)"
SD = "https://play.pokemonshowdown.com/sprites"
PA_RAW = "https://raw.githubusercontent.com/PokeAPI/sprites/master/"

ap = argparse.ArgumentParser()
for a in ["dex", "listings", "tree", "pokeapi-csv", "sheets", "cache", "out"]:
    ap.add_argument("--" + a, required=True)
args = ap.parse_args()
os.makedirs(args.cache, exist_ok=True)

def toid(s):
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("é", "e").replace("♀", "f").replace("♂", "m"))

# ---------------------------------------------------------------- entries
dex = json.load(open(args.dex, encoding="utf8"))["rows"]
PARADOX = {984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 1005, 1006, 1009, 1010, 1020, 1021, 1022, 1023}
for r in dex:
    if r["kind"] == "species" and r["num"] in PARADOX:
        r["category"] = "paradox"

# ---------------------------------------------------------------- Showdown listings
ROW = re.compile(r'href="\./([^"?/]+)">.*?class="filesize">([^<]*)<.*?class="filemtime">([^<]*)<', re.S)
SD_FOLDERS = ["gen5ani", "gen5ani-shiny", "gen5ani-back", "gen5ani-back-shiny", "gen5", "gen5-shiny",
              "ani", "ani-shiny", "dex", "home", "gen6"]
listing = {}
for f in SD_FOLDERS:
    p = os.path.join(args.listings, f"ls_{f}.html")
    txt = open(p, encoding="utf8").read()
    listing[f] = {html.unescape(m.group(1)): (m.group(2).strip(), m.group(3).strip()) for m in ROW.finditer(txt)}

def sd_name(folder, sid):
    ext = "gif" if ("ani" in folder) else "png"
    n = f"{sid}.{ext}"
    return n if n in listing[folder] else None

# ---------------------------------------------------------------- PokeAPI tree + id mapping
tree = set(l.strip() for l in open(args.tree, encoding="utf8"))
pk_rows = list(csv.DictReader(open(os.path.join(args.pokeapi_csv, "pokemon.csv"), encoding="utf8")))
by_toid = {}
for r in pk_rows:
    by_toid.setdefault(toid(r["identifier"]), int(r["id"]))
ALIASES = {  # showdown sprite id -> PokeAPI identifier, where plain normalisation differs
    "tauros-paldeacombat": "tauros-paldea-combat-breed", "tauros-paldeablaze": "tauros-paldea-blaze-breed",
    "tauros-paldeaaqua": "tauros-paldea-aqua-breed", "zygarde-10": "zygarde-10-power-construct",
    "basculin-whitestriped": "basculin-white-striped", "greninja-bond": "greninja-battle-bond",
    "necrozma-duskmane": "necrozma-dusk", "necrozma-dawnwings": "necrozma-dawn", "zygarde-complete": "zygarde-complete",
    "toxtricity-lowkeygmax": "toxtricity-low-key-gmax", "urshifu-gmax": "urshifu-single-strike-gmax",
    "urshifu-rapidstrikegmax": "urshifu-rapid-strike-gmax", "calyrex-ice": "calyrex-ice", "calyrex-shadow": "calyrex-shadow",
    "maushold-four": "maushold-family-of-four", "dudunsparce-threesegment": "dudunsparce-three-segment",
    "palafin-hero": "palafin-hero", "eiscue-noice": "eiscue-noice", "morpeko-hangry": "morpeko-hangry",
    "zacian-crowned": "zacian-crowned", "zamazenta-crowned": "zamazenta-crowned", "meowstic-f": "meowstic-female",
    "indeedee-f": "indeedee-female", "basculegion-f": "basculegion-female", "oinkologne-f": "oinkologne-female",
    "ogerpon-wellspring": "ogerpon-wellspring-mask", "ogerpon-hearthflame": "ogerpon-hearthflame-mask",
    "ogerpon-cornerstone": "ogerpon-cornerstone-mask", "squawkabilly-blue": "squawkabilly-blue-plumage",
    "squawkabilly-yellow": "squawkabilly-yellow-plumage", "squawkabilly-white": "squawkabilly-white-plumage",
    "tatsugiri-droopy": "tatsugiri-droopy", "tatsugiri-stretchy": "tatsugiri-stretchy",
    "gimmighoul-roaming": "gimmighoul-roaming", "pikachu-original": "pikachu-original-cap", "pikachu-hoenn": "pikachu-hoenn-cap",
    "pikachu-sinnoh": "pikachu-sinnoh-cap", "pikachu-unova": "pikachu-unova-cap", "pikachu-kalos": "pikachu-kalos-cap",
    "pikachu-alola": "pikachu-alola-cap", "pikachu-partner": "pikachu-partner-cap", "pikachu-world": "pikachu-world-cap",
    "pikachu-starter": "pikachu-starter", "eevee-starter": "eevee-starter", "floette-eternal": "floette-eternal",
    "oricorio-pompom": "oricorio-pom-pom", "oricorio-pau": "oricorio-pau", "rockruff-dusk": "rockruff-own-tempo",
    "magearna-original": "magearna-original", "terapagos-terastal": "terapagos-terastal", "terapagos-stellar": "terapagos-stellar",
    "ogerpon-tealtera": "ogerpon-teal-mask-tera", "ogerpon-wellspringtera": "ogerpon-wellspring-mask-tera",
    "ogerpon-hearthflametera": "ogerpon-hearthflame-mask-tera", "ogerpon-cornerstonetera": "ogerpon-cornerstone-mask-tera",
    "minior-meteor": "minior-red-meteor", "mimikyu-busted": "mimikyu-busted", "wishiwashi-school": "wishiwashi-school",
    "darmanitan-galarzen": "darmanitan-galar-zen", "mrmime-galar": "mr-mime-galar", "farfetchd-galar": "farfetchd-galar",
    "charizard-megax": "charizard-mega-x", "charizard-megay": "charizard-mega-y", "mewtwo-megax": "mewtwo-mega-x",
    "mewtwo-megay": "mewtwo-mega-y", "raichu-megax": "raichu-mega-x", "raichu-megay": "raichu-mega-y",
    "absol-megaz": "absol-mega-z", "garchomp-megaz": "garchomp-mega-z", "lucario-megaz": "lucario-mega-z",
    "meowstic-mmega": "meowstic-m-mega", "meowstic-fmega": "meowstic-f-mega",
}
def pokeapi_id(r):
    if r["kind"] == "species":
        return r["num"]
    sid = r["spriteId"]
    if sid in ALIASES and toid(ALIASES[sid]) in by_toid:
        return by_toid[toid(ALIASES[sid])]
    return by_toid.get(toid(sid))

PA = "sprites/pokemon/"
def pa_has(rel):
    return rel in tree

# ---------------------------------------------------------------- tracker sheets
DEFAULT_WORDS = {"male", "meadow", "baile", "midday", "disguised", "amped", "iceface", "fullbelly", "heroofmanybattles",
                 "singlestrike", "incarnate", "standard", "zero", "twosegment", "chest", "counterfeit", "unremarkable",
                 "tealmask", "familyofthree", "greenplumage", "curly", "50", "shield", "medium", "normal", "neutral", "confined",
                 "aria", "red", "redmeteor", "active", "natural", "ordinary", "averagesize", "average", "solo", "core"}
STRIP = ["mask", "breed", "plumage", "cap", "form", "forme", "color", "colour", "rider", "sword", "flower", "face", "segment", "mode", "build"]
SECTION_SUFFIX = {"alolan": "alola", "galarian": "galar", "hisuian": "hisui", "paldean": "paldea", "gigantamax": "gmax", "primal": "primal"}
ids_by_sid = {r["spriteId"]: r for r in dex}
base_by_num = {r["num"]: r for r in dex if r["kind"] == "species"}
name_to_sid = {}
for r in dex:
    if r["kind"] == "species":
        name_to_sid[toid(r["name"])] = r["spriteId"]

def match_sheet_row(section, num, name):
    """Map one tracker row to an entry spriteId. Order: section-specific forms, exact species name,
    form suffix, then dex number. Rows are often mislabelled/misnumbered, so name beats number."""
    sec = section.lower()
    nid = toid(name)
    SHEET_ALIASES = {"wishiwashisolo": "wishiwashi", "wishiwashischool": "wishiwashi-school", "zamazentacrownedshield": "zamazenta-crowned",
                     "zaciancrownedsword": "zacian-crowned", "dialgalord": "dialga-origin", "palkialord": "palkia-origin",
                     "mausholdfamilyoffour": "maushold-four", "miraidonultimatemode": "miraidon", "koraidonapexbuild": "koraidon",
                     "mabostiff": "mabosstiff", "zygarde100": "zygarde-complete", "greninjabattlebond": "greninja-bond"}
    if nid in SHEET_ALIASES and SHEET_ALIASES[nid] in ids_by_sid:
        return SHEET_ALIASES[nid]
    if "gigantamax" in sec and nid == "eternatus":
        return "eternatus-eternamax"
    base, _, suf = name.partition("-")
    if nid in name_to_sid and not any(k in sec for k in ("alolan", "galarian", "hisuian", "paldean", "gigantamax", "mega", "primal", "terastal")):
        return name_to_sid[nid]  # exact species name, incl. hyphenated (Jangmo-o, Wo-Chien)
    bid = toid(base)
    s = toid(suf)
    s2 = s
    for w in STRIP:
        if s2.endswith(w) and len(s2) > len(w):
            s2 = s2[: -len(w)]
    for k, v in SECTION_SUFFIX.items():
        if k in sec:
            if v == "gmax":
                cands = [f"{bid}-{s2}gmax", f"{bid}-{s}gmax"] if s and s not in DEFAULT_WORDS else [f"{bid}-gmax"]
            elif v == "primal":
                cands = [f"{bid}-primal"]
            else:
                cands = [f"{bid}-{v}{s2}", f"{bid}-{v}{s}"] if s and s not in DEFAULT_WORDS else [f"{bid}-{v}"]
            return next((c for c in cands if c in ids_by_sid), None)
    if "mega" in sec:
        x = s.replace("mega", "")
        cand = f"{bid}-mega{x}" if x in ("x", "y", "z") else f"{bid}-mega"
        return cand if cand in ids_by_sid else None
    if "terastal" in sec:
        x = s.replace("mask", "")
        return next((c for c in (f"{bid}-{x}tera", f"{bid}-{x}") if c in ids_by_sid), None)
    if not suf:
        b = base_by_num.get(num)
        if b and toid(b["name"]) == nid:
            return b["spriteId"]
        return bid if bid in ids_by_sid else None
    if s in DEFAULT_WORDS:
        return bid if bid in ids_by_sid else "__default_of_pre_gen6__"
    if s == "female":
        return f"{bid}-f" if f"{bid}-f" in ids_by_sid else None
    return next((c for c in (f"{bid}-{s}", f"{bid}-{s2}") if c in ids_by_sid), None)

sheet = {}  # sid -> {"anim": {...}, "static": {...}, "gen": n}
unmatched_sheet = []
for g in (6, 7, 8, 9):
    for kind in ("anim", "static"):
        p = os.path.join(args.sheets, f"g{g}_{kind}.csv")
        section = ""
        for row in csv.reader(open(p, encoding="utf8")):
            row += [""] * (8 - len(row))
            if row[0] and not row[0][:1].isdigit():
                section = row[0]
                continue
            if not row[0][:1].isdigit():
                continue
            num, name = int(row[0]), row[1].strip()
            sid = match_sheet_row(section, num, name)
            rec = {"front": row[2].strip(), "back": row[3].strip(), "shiny": row[4].strip(), "backShiny": row[5].strip(),
                   "artist": row[6].strip(), "qc": row[7].strip(), "row": f"{num} {name}", "section": section, "sheetGen": g}
            if not sid or sid == "__default_of_pre_gen6__":
                if any(rec[k] for k in ("front", "shiny")):
                    unmatched_sheet.append({"sheet": f"g{g}_{kind}", **rec, "reason": "default form of pre-Gen6 species" if sid else "no matching entry"})
                continue
            slot = sheet.setdefault(sid, {})
            # keep the first row that has links (duplicates exist, e.g. Urshifu twice in Gen 8)
            if kind not in slot or not slot[kind].get("front"):
                slot[kind] = rec

# ---------------------------------------------------------------- download + inspect
def cache_path(url):
    h = hashlib.sha1(url.encode()).hexdigest()[:16]
    ext = os.path.splitext(url.split("?")[0].rstrip("/"))[1][:5] or ".bin"
    return os.path.join(args.cache, h + ext)

def fetch(url):
    p = cache_path(url)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p, 200
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(p, "wb") as f:
                f.write(data)
            return p, 200
        except urllib.error.HTTPError as e:
            if e.code in (404, 403, 410):
                return None, e.code
            time.sleep(1 + attempt * 2)
        except Exception:
            time.sleep(1 + attempt * 2)
    return None, -1

def inspect(path):
    out = {"ok": False}
    try:
        raw = open(path, "rb").read()
        out["bytes"] = len(raw)
        out["sha1"] = hashlib.sha1(raw).hexdigest()
        im = Image.open(io.BytesIO(raw))
        out["format"] = im.format
        out["size"] = f"{im.width}x{im.height}"
        out["loop"] = im.info.get("loop")
        frames, durs, hashes, maxcols, alpha_levels = 0, [], set(), 0, set()
        for fr in ImageSequence.Iterator(im):
            frames += 1
            durs.append(fr.info.get("duration", 0) or 0)
            rgba = fr.convert("RGBA")
            b = rgba.tobytes()
            hashes.add(hashlib.md5(b).digest())
            if frames <= 3 or frames % 10 == 0:  # sample frames for palette/alpha stats
                cols = rgba.getcolors(1 << 16) or []
                maxcols = max(maxcols, sum(1 for c, px in cols if px[3]))
                alpha_levels |= {px[3] for c, px in cols}
        out.update(frames=frames, uniqueFrames=len(hashes), totalMs=sum(durs),
                   minDelay=min(durs) if durs else 0, maxColors=maxcols, alphaLevels=len(alpha_levels),
                   hasTransparency=0 in alpha_levels)
        out["animated"] = len(hashes) > 1
        # 2D pixel-art heuristic: binary alpha and a small palette (BW sprites use <=16 colours;
        # community gen5-style allows a little more). 3D renders/HOME art have many colours or soft alpha.
        out["pixelStyle"] = out["alphaLevels"] <= 2 and maxcols <= 32
        out["ok"] = True
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
    return out

jobs = {}  # url -> path/inspection
def want(url):
    jobs.setdefault(url, None)

ANI = ["gen5ani", "gen5ani-shiny", "gen5ani-back", "gen5ani-back-shiny"]
for r in dex:
    sid = r["spriteId"]
    r["sd"] = {f: sd_name(f, sid) for f in SD_FOLDERS}
    for f in ANI + ["gen5", "gen5-shiny"]:
        if r["sd"][f]:
            want(f"{SD}/{f}/{r['sd'][f]}")
    pid = pokeapi_id(r)
    r["pokeapiId"] = pid
    pa = {}
    if pid:
        for key, rel in {
            "bwAni": f"{PA}versions/generation-v/black-white/animated/{pid}.gif",
            "bwAniShiny": f"{PA}versions/generation-v/black-white/animated/shiny/{pid}.gif",
            "bwAniBack": f"{PA}versions/generation-v/black-white/animated/back/{pid}.gif",
            "bwAniBackShiny": f"{PA}versions/generation-v/black-white/animated/back/shiny/{pid}.gif",
            "bwStatic": f"{PA}versions/generation-v/black-white/{pid}.png",
            "bwStaticShiny": f"{PA}versions/generation-v/black-white/shiny/{pid}.png",
            "default": f"{PA}{pid}.png",
            "defaultShiny": f"{PA}shiny/{pid}.png",
            "artwork": f"{PA}other/official-artwork/{pid}.png",
            "artworkShiny": f"{PA}other/official-artwork/shiny/{pid}.png",
            "home": f"{PA}other/home/{pid}.png",
            "showdown3d": f"{PA}other/showdown/{pid}.gif",
        }.items():
            pa[key] = rel if pa_has(rel) else None
        # PokeAPI BW animated: inspect when Showdown lacks the file (extra coverage) and for mirror comparison
        for key, sdf in (("bwAni", "gen5ani"), ("bwAniShiny", "gen5ani-shiny"), ("bwAniBack", "gen5ani-back"), ("bwAniBackShiny", "gen5ani-back-shiny")):
            if pa[key]:
                want(PA_RAW + pa[key])
        for key in ("bwStatic", "bwStaticShiny"):
            if pa[key]:
                want(PA_RAW + pa[key])
    r["pa"] = pa
    sh = sheet.get(sid, {})
    r["sheet"] = sh
    # Only hit the Smogon forum for variants no published mirror has (keeps load on smogon.com low).
    published = {"front": r["sd"]["gen5ani"] or pa.get("bwAni"), "shiny": r["sd"]["gen5ani-shiny"] or pa.get("bwAniShiny"),
                 "back": r["sd"]["gen5ani-back"] or pa.get("bwAniBack"), "backShiny": r["sd"]["gen5ani-back-shiny"] or pa.get("bwAniBackShiny")}
    for k in ("front", "shiny", "back", "backShiny"):
        u = sh.get("anim", {}).get(k)
        if u and u.startswith("http") and not published[k]:
            want(u)
    for k in ("front", "shiny"):
        u = sh.get("static", {}).get(k)
        if u and u.startswith("http") and not r["sd"]["gen5"]:
            want(u)

urls = sorted(jobs)
print(f"entries {len(dex)}; files to fetch/inspect {len(urls)}", flush=True)

def work(u):
    p, code = fetch(u)
    res = inspect(p) if p else {"ok": False, "error": f"HTTP {code}"}
    res["http"] = code
    return u, res

done = 0
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    for u, res in ex.map(work, urls):
        jobs[u] = res
        done += 1
        if done % 250 == 0:
            print(f"  {done}/{len(urls)}", flush=True)

json.dump({"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "entries": dex, "files": jobs,
           "listingCounts": {f: len(v) for f, v in listing.items()}, "unmatchedSheetRows": unmatched_sheet,
           "pokeapiCommit": None}, open(args.out, "w", encoding="utf8"), indent=1)
print("wrote", args.out)
