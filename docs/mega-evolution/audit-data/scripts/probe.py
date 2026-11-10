"""Read-only probe of Mega/Primal sprite candidates. Downloads only into --dl."""
import csv, hashlib, io, json, os, re, sys, urllib.request, concurrent.futures as cf
from PIL import Image, ImageSequence
base, dl = sys.argv[1], sys.argv[2]
UA = "sprite-audit/1.0 (read-only)"
SD = "https://play.pokemonshowdown.com/sprites"
PA = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white"
megas = json.load(open(os.path.join(base, "showdown-megas.json"), encoding="utf8"))
forms = list(csv.DictReader(open(os.path.join(base, "pokemon_forms.csv"), encoding="utf8")))
pid = {r["identifier"].replace("-", ""): int(r["pokemon_id"]) for r in forms}
def toid(s): return re.sub(r"[^a-z0-9]", "", s.lower())
alias = {"meowsticmmega": "meowsticmalemega", "meowsticfmega": "meowsticfemalemega"}
def fetch(url):
    fn = os.path.join(dl, hashlib.sha1(url.encode()).hexdigest()[:16] + os.path.splitext(url)[1])
    if not os.path.exists(fn):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r: data = r.read()
        except Exception as e:
            return None, str(getattr(e, "code", e))
        open(fn, "wb").write(data)
    return open(fn, "rb").read(), None
def inspect(data):
    im = Image.open(io.BytesIO(data))
    frames = [f.convert("RGBA") for f in ImageSequence.Iterator(im)]
    colours, alphas, uniq = set(), set(), set()
    for f in frames:
        px = f.getdata()
        uniq.add(hashlib.sha1(f.tobytes()).hexdigest())
        for p in px:
            alphas.add(p[3])
            if p[3]: colours.add(p[:3])
    first = frames[0]; bbox = first.getbbox()
    return {"format": im.format, "w": im.width, "h": im.height, "frames": len(frames), "uniqueFrames": len(uniq),
            "colours": len(colours), "alphaLevels": len(alphas), "transparent": 0 in alphas,
            "bbox": bbox, "loop": im.info.get("loop"), "bytes": len(data), "sha1": hashlib.sha1(data).hexdigest(),
            "pix": hashlib.sha1(first.tobytes()).hexdigest()}
def probe(m):
    sid = toid(m["baseSpecies"]) + "-" + toid(m["forme"]); key = toid(m["name"]); p = pid.get(alias.get(key, key))
    cands = {
      "sd_ani": f"{SD}/gen5ani/{sid}.gif", "sd_ani_shiny": f"{SD}/gen5ani-shiny/{sid}.gif",
      "sd_static": f"{SD}/gen5/{sid}.png", "sd_static_shiny": f"{SD}/gen5-shiny/{sid}.png",
      "sd_3d_ani": f"{SD}/ani/{sid}.gif",
    }
    if p:
        cands.update({"pa_ani": f"{PA}/animated/{p}.gif", "pa_ani_shiny": f"{PA}/animated/shiny/{p}.gif",
                      "pa_static": f"{PA}/{p}.png", "pa_static_shiny": f"{PA}/shiny/{p}.png"})
    res = {"name": m["name"], "spriteid": sid, "pokeapiId": p, "files": {}}
    for k, u in cands.items():
        data, err = fetch(u)
        if data is None: res["files"][k] = {"url": u, "missing": err}; continue
        if k == "sd_3d_ani": res["files"][k] = {"url": u, "exists": True}; continue
        try: info = inspect(data)
        except Exception as e: info = {"error": str(e)}
        info["url"] = u; res["files"][k] = info
    return res
with cf.ThreadPoolExecutor(8) as ex: out = list(ex.map(probe, megas))
json.dump(out, open(os.path.join(base, "probe-results.json"), "w"), indent=1)
print("done", len(out))
