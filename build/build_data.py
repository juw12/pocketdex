"""Build pokedex/data.js and download sprites from the PokeAPI GitHub mirrors."""
import concurrent.futures
import csv
import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "build" / "raw"
APP = ROOT
ENGLISH = "9"
SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/"


def rows(name):
    with open(RAW / name, encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def build_dex():
    species = {int(r["id"]): r for r in rows("pokemon_species.csv")}
    default_form = {}
    for r in rows("pokemon.csv"):
        if r["is_default"] == "1" and int(r["species_id"]) in species:
            default_form[int(r["species_id"])] = r

    type_names = {int(r["id"]): r["identifier"] for r in rows("types.csv")}
    types_by_pokemon = defaultdict(list)
    for r in sorted(rows("pokemon_types.csv"), key=lambda r: int(r["slot"])):
        types_by_pokemon[int(r["pokemon_id"])].append(type_names[int(r["type_id"])])

    stats = defaultdict(dict)
    for r in rows("pokemon_stats.csv"):
        stats[int(r["pokemon_id"])][int(r["stat_id"])] = int(r["base_stat"])

    names, genus = {}, {}
    for r in rows("pokemon_species_names.csv"):
        if r["local_language_id"] == ENGLISH:
            # Gender symbols render as colour emoji on some systems; spell them as F / M.
            names[int(r["pokemon_species_id"])] = r["name"].replace("\u2640", " F").replace("\u2642", " M")
            genus[int(r["pokemon_species_id"])] = r["genus"]

    flavor = {}
    for r in rows("pokemon_species_flavor_text.csv"):
        if r["language_id"] != ENGLISH:
            continue
        sid = int(r["species_id"])
        version = int(r["version_id"])
        text = r["flavor_text"].replace("\f", " ").replace("\u00ad", "")
        text = re.sub(r"\s+", " ", text).strip()
        score = version if 7 <= version <= 22 else version / 1000
        if sid not in flavor or score > flavor[sid][0]:
            flavor[sid] = (score, text)

    ability_names = {
        int(r["ability_id"]): r["name"]
        for r in rows("ability_names.csv")
        if r["local_language_id"] == ENGLISH
    }
    abilities = defaultdict(list)
    for r in sorted(rows("pokemon_abilities.csv"), key=lambda r: int(r["slot"])):
        name = ability_names.get(int(r["ability_id"]))
        if name:
            abilities[int(r["pokemon_id"])].append(name + ("*" if r["is_hidden"] == "1" else ""))

    habitats = {
        int(r["pokemon_habitat_id"]): r["name"]
        for r in rows("pokemon_habitat_names.csv")
        if r["local_language_id"] == ENGLISH
    }
    colors = {
        int(r["pokemon_color_id"]): r["name"]
        for r in rows("pokemon_color_names.csv")
        if r["local_language_id"] == ENGLISH
    }

    dex = []
    for sid in sorted(species):
        s = species[sid]
        p = default_form.get(sid)
        if not p:
            continue
        pid = int(p["id"])
        dex.append({
            "id": sid,
            "n": names.get(sid, s["identifier"].title()),
            "g": genus.get(sid, "").replace(" Pokémon", ""),
            "t": types_by_pokemon[pid],
            "s": [stats[pid].get(i, 0) for i in range(1, 7)],
            "h": int(p["height"]),
            "w": int(p["weight"]),
            "gen": int(s["generation_id"]),
            "from": int(s["evolves_from_species_id"] or 0),
            "ch": int(s["evolution_chain_id"] or 0),
            "f": flavor.get(sid, (0, ""))[1],
            "a": abilities[pid],
            "cr": int(s["capture_rate"] or 45),
            "c": colors.get(int(s["color_id"] or 0), ""),
            "hab": habitats.get(int(s["habitat_id"]), "") if s["habitat_id"] else "",
            "leg": 2 if s["is_mythical"] == "1" else (1 if s["is_legendary"] == "1" else 0),
        })

    efficacy = defaultdict(dict)
    for r in rows("type_efficacy.csv"):
        factor = int(r["damage_factor"])
        if factor != 100:
            attacker = type_names[int(r["damage_type_id"])]
            defender = type_names[int(r["target_type_id"])]
            efficacy[attacker][defender] = factor / 100
    return dex, efficacy


def fetch_sprite(sid):
    target = APP / "sprites" / f"{sid}.png"
    if target.exists() and target.stat().st_size > 0:
        return sid, True
    last = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(f"{SPRITE_BASE}{sid}.png", timeout=30) as response:
                target.write_bytes(response.read())
            return sid, True
        except Exception as error:  # network hiccup; retry
            last = error
    return sid, str(last)


def main():
    (APP / "sprites").mkdir(parents=True, exist_ok=True)
    dex, efficacy = build_dex()
    payload = {"dex": dex, "eff": efficacy}
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    header = "/* Generated from PokeAPI CSV data (github.com/PokeAPI/pokeapi). */\n"
    (APP / "data.js").write_text(header + "window.DEX_DATA = " + body + ";\n", encoding="utf-8", newline="\n")
    print("data.js written", len(dex), "species", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(fetch_sprite, [d["id"] for d in dex]))
    failed = [r for r in results if r[1] is not True]
    total = sum(f.stat().st_size for f in (APP / "sprites").glob("*.png"))
    print("sprites failed:", len(failed), failed[:5], "total KB:", total // 1024, flush=True)


if __name__ == "__main__":
    main()
