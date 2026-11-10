"""04-report-tables.py — read-only. Prints the Markdown tables used in the reports from summary.json.
Usage: python -P -E 04-report-tables.py summary.json > tables.md
"""
import collections, json, sys

sys.stdout.reconfigure(encoding="utf-8")
S = json.load(open(sys.argv[1], encoding="utf8"))
rows = S["rows"]
sp = [r for r in rows if r["kind"] == "species"]
fm = [r for r in rows if r["kind"] != "species"]
GENS = (6, 7, 8, 9)
TOT = {6: 72, 7: 88, 8: 96, 9: 120}
pct = lambda a, b: f"{100 * a / b:.1f}%" if b else "—"
out = []
p = out.append

p("## T1 Species classification by generation\n")
p("| Generation | Total species | A | B | C | D | E | U | Animated 2D coverage % (A+B) | Fully ready % (A) |")
p("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
tot = collections.Counter()
for g in GENS:
    c = collections.Counter(r["classification"] for r in sp if r["generation"] == g)
    n = sum(c.values()); tot.update(c)
    p(f"| Gen {g} | {n} | " + " | ".join(str(c[k]) for k in "ABCDEU") + f" | {pct(c['A'] + c['B'], n)} | {pct(c['A'], n)} |")
n = sum(tot.values())
p(f"| **Total** | **{n}** | " + " | ".join(f"**{tot[k]}**" for k in "ABCDEU") + f" | **{pct(tot['A'] + tot['B'], n)}** | **{pct(tot['A'], n)}** |\n")

def asset_table(title, keys):
    p(f"## {title}\n")
    p("| Generation | Species | " + " | ".join(k[1] for k in keys) + " |")
    p("|---|---:|" + "---:|" * len(keys))
    allc = collections.Counter()
    for g in GENS:
        rs = [r for r in sp if r["generation"] == g]
        cells = []
        for col, label in keys:
            v = sum(1 for r in rs if r[col] == "yes"); allc[col] += v
            cells.append(f"{v} ({pct(v, len(rs))})")
        p(f"| Gen {g} | {len(rs)} | " + " | ".join(cells) + " |")
    p(f"| **Total** | **{len(sp)}** | " + " | ".join(f"**{allc[c]} ({pct(allc[c], len(sp))})**" for c, _ in keys) + " |\n")

asset_table("T2 Individual asset coverage — fronts and shiny (species)", [("normal_animated_2d", "Animated front"), ("shiny_animated_2d", "Animated shiny front"), ("normal_static_2d", "Static front"), ("shiny_static_2d", "Static shiny"), ("artwork_fallback", "Official artwork")])
asset_table("T3 Individual asset coverage — back sprites (species)", [("back_animated_2d", "Animated back"), ("shiny_back_animated_2d", "Animated shiny back")])

p("## T4 Shiny readiness per species (what a shiny roll could display)\n")
p("| Generation | Animated shiny | Animated normal but shiny only static | Animated normal, no distinct shiny at all | Static only: static shiny | Static only: no shiny |")
p("|---|---:|---:|---:|---:|---:|")
for g in GENS:
    rs = [r for r in sp if r["generation"] == g]
    a = sum(1 for r in rs if r["shiny_animated_2d"] == "yes")
    b = sum(1 for r in rs if r["normal_animated_2d"] == "yes" and r["shiny_animated_2d"] == "no" and r["shiny_static_2d"] == "yes")
    c = sum(1 for r in rs if r["normal_animated_2d"] == "yes" and r["shiny_animated_2d"] == "no" and r["shiny_static_2d"] == "no")
    d = sum(1 for r in rs if r["normal_animated_2d"] == "no" and r["shiny_static_2d"] == "yes")
    e = sum(1 for r in rs if r["normal_animated_2d"] == "no" and r["shiny_static_2d"] == "no")
    p(f"| Gen {g} | {a} | {b} | {c} | {d} | {e} |")
p("")

CATS = [("regional-alola", "Alolan forms"), ("regional-galar", "Galarian forms"), ("regional-hisui", "Hisuian forms"), ("regional-paldea", "Paldean forms"),
        ("mega", "Mega Evolutions"), ("primal", "Primal Reversions"), ("gigantamax", "Gigantamax"), ("terastal", "Terastal forms"),
        ("battle-only", "Other battle-only forms"), ("gender", "Gender-specific (sprite-only)"), ("cosmetic", "Cosmetic forms"), ("other", "Other visually distinct forms")]
p("## T5 Alternate forms (counted separately from species)\n")
p("| Form group | Forms | A | B | C | D | E | U | Animated (A+B) | Animated shiny |")
p("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
for cat, label in CATS:
    rs = [r for r in fm if r["category"] == cat]
    if not rs: continue
    c = collections.Counter(r["classification"] for r in rs)
    sh = sum(1 for r in rs if r["shiny_animated_2d"] == "yes")
    p(f"| {label} | {len(rs)} | " + " | ".join(str(c[k]) for k in "ABCDEU") + f" | {pct(c['A'] + c['B'], len(rs))} | {sh} |")
c = collections.Counter(r["classification"] for r in fm)
p(f"| **All forms** | **{len(fm)}** | " + " | ".join(f"**{c[k]}**" for k in "ABCDEU") + f" | **{pct(c['A'] + c['B'], len(fm))}** | **{sum(1 for r in fm if r['shiny_animated_2d'] == 'yes')}** |\n")

p("## T6 Mega Evolutions by era\n")
megas = [r for r in fm if r["category"] == "mega"]
era = lambda r: "Legends: Z-A (2025) megas" if r["form_identifier"] in ZA else "X/Y + ORAS megas"
ZA = {"raichu-megax", "raichu-megay", "clefable-mega", "victreebel-mega", "starmie-mega", "dragonite-mega", "meganium-mega", "feraligatr-mega", "skarmory-mega", "chimecho-mega", "absol-megaz", "staraptor-mega", "garchomp-megaz", "lucario-megaz", "froslass-mega", "heatran-mega", "darkrai-mega", "emboar-mega", "excadrill-mega", "scolipede-mega", "scrafty-mega", "eelektross-mega", "chandelure-mega", "golurk-mega", "chesnaught-mega", "delphox-mega", "greninja-mega", "pyroar-mega", "floette-mega", "malamar-mega", "barbaracle-mega", "dragalge-mega", "hawlucha-mega", "zygarde-mega", "crabominable-mega", "golisopod-mega", "drampa-mega", "magearna-mega", "magearna-originalmega", "zeraora-mega", "falinks-mega", "scovillain-mega", "glimmora-mega", "baxcalibur-mega", "meowstic-mmega", "meowstic-fmega", "tatsugiri-curlymega", "tatsugiri-droopymega", "tatsugiri-stretchymega"}
p("| Era | Megas | A | B | C | D | E | U |")
p("|---|---:|---:|---:|---:|---:|---:|---:|")
for e_ in ("X/Y + ORAS megas", "Legends: Z-A (2025) megas"):
    rs = [r for r in megas if era(r) == e_]
    c = collections.Counter(r["classification"] for r in rs)
    p(f"| {e_} | {len(rs)} | " + " | ".join(str(c[k]) for k in "ABCDEU") + " |")
p("")

p("## T7 Paradox and legendary/mythical species\n")
p("| Group | Species | A | B | C | D | E | U |")
p("|---|---:|---:|---:|---:|---:|---:|---:|")
for label, f in (("Paradox Pokémon", lambda r: r["category"] == "paradox"), ("Legendary", lambda r: r["legendary"]), ("Mythical", lambda r: r["mythical"]), ("Ultra Beasts", lambda r: "Ultra Beast" in r["tags"])):
    rs = [r for r in sp if f(r)]
    c = collections.Counter(r["classification"] for r in rs)
    p(f"| {label} | {len(rs)} | " + " | ".join(str(c[k]) for k in "ABCDEU") + " |")
p("")

p("## T8 Rollout options — eligible species per generation\n")
p("| Generation | Total | Option A: animated + animated shiny (A) | Option A′: any published animated front (A + published B) | Option B: animated or static 2D (A+B+C) | Option C: whole generation |")
p("|---|---:|---:|---:|---:|---:|")
for g in GENS + ("Total",):
    rs = sp if g == "Total" else [r for r in sp if r["generation"] == g]
    a = sum(1 for r in rs if r["classification"] == "A")
    a2 = sum(1 for r in rs if r["classification"] == "A" or (r["classification"] == "B" and r["frontSrc"] in ("sd", "pa")))
    b = sum(1 for r in rs if r["classification"] in "ABC")
    p(f"| {'Gen ' + str(g) if g != 'Total' else '**Total**'} | {len(rs)} | {a} ({pct(a, len(rs))}) | {a2} ({pct(a2, len(rs))}) | {b} ({pct(b, len(rs))}) | {len(rs)} (100%) |")
p("")

p("## T9 Source contribution (species, animated front)\n")
c = collections.Counter(r["frontSrc"] for r in sp)
p(f"- Showdown `gen5ani` (preferred where present): {c['sd']}\n- PokéAPI `black-white/animated` only: {c['pa']}\n- Smogon tracker attachment only (unpublished): {c['sm']}\n- None: {c[None]}\n")
m = S["mirror"]
p(f"Mirror check, all {sum(m.values())} entries with an animated front on either mirror: identical bytes {m.get('identical', 0)}, both present but different files {m.get('differs', 0)}, Showdown only {m.get('showdown-only', 0)}, PokéAPI only {m.get('pokeapi-only', 0)}.\n")
by = [r["bytes"] for r in sp if r["normal_animated_2d"] == "yes" and r["bytes"]]
if by:
    by.sort()
    p(f"Animated front file size (species, preferred file): median {by[len(by)//2]/1024:.0f} KiB, max {by[-1]/1024:.0f} KiB, total {sum(by)/1024/1024:.1f} MiB for {len(by)} files.\n")
print("\n".join(out))
