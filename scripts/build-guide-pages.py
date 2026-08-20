"""Builds guide-dex.html and guide-items.html from data pulled out of the running game.

    python scripts/build-guide-pages.py <dir-holding-dex.json-and-extra.json>

Those two files are dumped from the game itself - see "Regenerating the guide pages" in
docs/homework-quest.md for the snippet. Reading the running game rather than parsing the source
means the names, stats and item text are exactly what a player sees, in whatever language the
game is set to.

Both pages point at the game's own art (`./images/...`), which the site already serves, so nothing
is duplicated and both work offline alongside the game.
"""

import io
import json
import os
import re

import sys

# Directory holding dex.json and extra.json, as dumped by the snippet in docs/homework-quest.md.
SP = sys.argv[1] if len(sys.argv) > 1 else "."
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

dex = json.load(open(os.path.join(SP, "dex.json"), encoding="utf-8"))
extra = json.load(open(os.path.join(SP, "extra.json"), encoding="utf-8"))
families, icons, items = dex["families"], extra["icons"], extra["items"]

# ---- icon atlases: turn (atlas, frame) into a rect we can slice with background-position --------
atlas_names, atlas_index = [], {}
frames = {}
for name in sorted({a for a, _ in icons.values()}):
    path = os.path.join(REPO, "assets/images", name + ".json")
    if not os.path.exists(path):
        continue
    atlas_index[name] = len(atlas_names)
    atlas_names.append(name)
    meta = json.load(open(path, encoding="utf-8"))
    entries = meta["textures"][0]["frames"] if "textures" in meta else meta["frames"]
    if isinstance(entries, dict):
        entries = [{"filename": k, **v} for k, v in entries.items()]
    for e in entries:
        f = e["frame"]
        frames[(name, str(e["filename"]))] = [f["x"], f["y"], f["w"], f["h"]]

def icon_for(species_id):
    """[atlasIndex, x, y, w, h] for a species, or None when the sheet has no frame for it."""
    pair = icons.get(str(species_id))
    if not pair:
        return None
    atlas, frame = pair
    rect = frames.get((atlas, frame))
    if rect is None or atlas not in atlas_index:
        return None
    return [atlas_index[atlas]] + rect

# ---- dex rows ----------------------------------------------------------------------------------
# The passive is registered against the starter species only, but it applies to everything the line
# evolves into, so it is carried down the family here rather than left blank on the later stages.
# Species reachable from two roots would otherwise be listed twice; the first family wins.
seen_ids = set()
compact = []
for fam in families:
    passive = next((m["p"] for m in fam if m["p"]), "")
    # Rarity, like the passive, is registered against the family's first stage and describes the whole
    # line: it is what the egg pool rolls on, and an egg hatches into the first stage regardless.
    tier = next((m.get("tier") for m in fam if m.get("tier") is not None), None)
    rows = []
    for m in fam:
        if m["id"] in seen_ids:
            continue
        seen_ids.add(m["id"])
        # [name, types, abilities, hidden, passive, stats, cost, depth, icon, tier]
        rows.append([
            m["n"], m["t"], m["a"], m["h"], m["p"] or passive, m["s"], m["c"], m["depth"],
            icon_for(m["id"]), m.get("tier") if m.get("tier") is not None else tier,
        ])
    if rows:
        compact.append(rows)

dex_payload = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
atlas_payload = json.dumps(atlas_names, ensure_ascii=False, separators=(",", ":"))
species_total = sum(len(f) for f in compact)

# ---- item rows ---------------------------------------------------------------------------------
item_dir = os.path.join(REPO, "assets/images/items")
have = {os.path.splitext(f)[0] for f in os.listdir(item_dir)} if os.path.isdir(item_dir) else set()

GROUPS = {
    "pb": "精灵球",
    "revive": "回复与复活",
    "potion": "回复与复活",
    "mint": "性格薄荷",
    "tm": "招式机",
    "exp": "经验",
    "berry": "树果",
    "vitamin": "能力提升",
}

def clean(desc):
    """Drops the live inventory count the game splices into a description; a manual has no run."""
    return re.sub(r"\s*[（(](?:已有|Have)[：:]\s*\d+[）)]", "", desc).strip()

rows = []
for it in items:
    # Generator types only resolve a name once they are rolled against a real run, so they come back
    # as the raw i18n key. Nothing useful to show for those.
    if not it["name"] or it["name"].startswith("null."):
        continue
    rows.append([it["name"], clean(it["desc"]), it["icon"] if it["icon"] in have else "", GROUPS.get(it["group"], "")])
item_payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))

SHARED_CSS = """
  :root {
    --ink:#eceaf2; --ink-dim:#a9a3bb; --ink-faint:#6f6883;
    --bg:#1b1823; --panel:#2a2436; --panel-2:#332b42; --line:#453c58;
    --accent:#e8542f; --accent-soft:#f0855f; --gold:#f2c14e;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.6 "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif; }
  a { color: var(--accent-soft); }
  .wrap { max-width:1240px; margin:0 auto; padding:28px 20px 80px; }
  header { border-bottom:1px solid var(--line); padding-bottom:18px; }
  h1 { margin:0 0 4px; font-size:1.7rem; color:var(--gold); }
  header p { margin:0 0 4px; color:var(--ink-dim); font-size:.94rem; }
  .controls { position:sticky; top:0; z-index:5; background:var(--bg);
    padding:14px 0 12px; border-bottom:1px solid var(--line);
    display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  input[type=search] { flex:1 1 240px; min-width:200px; background:var(--panel); color:var(--ink);
    border:1px solid var(--line); border-radius:8px; padding:8px 12px; font:inherit; }
  input[type=search]::placeholder { color: var(--ink-faint); }
  select, button { background:var(--panel); color:var(--ink); border:1px solid var(--line);
    border-radius:8px; padding:8px 12px; font:inherit; cursor:pointer; }
  .count { color:var(--ink-faint); font-size:.88rem; margin-left:auto; }
  table { border-collapse:collapse; width:100%; margin-top:8px; font-size:.9rem; }
  th, td { padding:6px 8px; text-align:left; white-space:nowrap; }
  thead th { position:sticky; top:63px; background:var(--panel-2); z-index:4;
    border-bottom:1px solid var(--line); user-select:none; }
  tbody tr { border-bottom:1px solid #ffffff0d; }
  tbody tr:hover { background:#ffffff08; }
  td.n { text-align:right; font-variant-numeric:tabular-nums; }
  footer { margin-top:40px; color:var(--ink-faint); font-size:.85rem;
    border-top:1px solid var(--line); padding-top:16px; }
  footer p { margin:6px 0; }
"""

DEX = r"""<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>作业勇者 · 宝可梦图鉴</title>
<style>__CSS__
  thead th[data-k] { cursor:pointer; }
  thead th span.dir { color:var(--accent); margin-left:4px; }
  tbody tr.fam-start { border-top:2px solid var(--line); }
  td.total { font-weight:700; color:var(--gold); }
  .ico { display:block; image-rendering:pixelated; transform:scale(1.15); transform-origin:left center; }
  .icocell { width:52px; padding-left:4px; }
  .stage { display:inline-block; min-width:3.4em; text-align:center; padding:1px 6px; border-radius:5px;
    font-size:.76rem; background:var(--panel-2); color:var(--ink-dim); }
  .stage.s0 { background:#2f4a6b; color:#bcd9f5; }
  .stage.s1 { background:#4a3f6b; color:#d0c6f5; }
  .stage.s2 { background:#6b4a2f; color:#f5d8bc; }
  .tier { display:inline-block; min-width:3.4em; text-align:center; padding:1px 6px; border-radius:5px;
    font-size:.76rem; font-weight:600; }
  .tier.t0 { background:#3a3547; color:#c3bdd1; }
  .tier.t1 { background:#25506e; color:#a9d6f5; }
  .tier.t2 { background:#4a2d6b; color:#dcc0f5; }
  .tier.t3 { background:#6b5510; color:#f7dd8a; }
  .name { font-weight:600; }
  .chip { display:inline-block; padding:1px 8px; border-radius:9px; font-size:.76rem;
    color:#14121b; font-weight:700; margin-right:3px; }
  .abil { color:var(--ink-dim); font-size:.84rem; white-space:normal; max-width:230px; }
  .abil .hid { color:var(--accent-soft); }
  .abil .pas { color:#7fd6a3; }
  .bar { display:block; height:3px; border-radius:2px; background:#ffffff1a; margin-top:3px; }
  .bar i { display:block; height:100%; border-radius:2px; background:var(--accent-soft); }
  @media (max-width:820px) { .abil, th.abil-h { display:none; } }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>宝可梦图鉴 · 成长路径与能力值</h1>
  <p>按进化家族排列：<b>初始 → 中级 → 终极</b>。数据与图标都取自游戏本体。<a href="./guide.html">← 游戏指南</a> · <a href="./guide-items.html">道具图鉴 →</a></p>
  <p><b>「稀有度」</b>是这一族在扭蛋池里的档位：<span class="tier t0">普通</span> → <span class="tier t1">稀有</span> → <span class="tier t2">史诗</span> → <span class="tier t3">传说</span>。档位属于整条进化链，因为蛋孵出来的一定是第一阶段。</p>
  <p><b>「总计」</b>是六项数值相加，也就是这只宝可梦的<b>综合强度</b>。妙蛙种子 318 → 妙蛙草 405 → 妙蛙花 525，进化一次涨一截。一般来说 500 以上算强力，600 是传说级。</p>
</header>

<div class="controls">
  <input type="search" id="q" placeholder="搜名字，例如「妙蛙」「皮卡」…" autocomplete="off" />
  <select id="type"><option value="">全部属性</option></select>
  <select id="tier">
    <option value="">全部稀有度</option>
    <option value="0">普通</option>
    <option value="1">稀有</option>
    <option value="2">史诗</option>
    <option value="3">传说</option>
  </select>
  <select id="cost">
    <option value="">全部</option>
    <option value="starter">只看可选初始</option>
  </select>
  <button id="reset">重置</button>
  <span class="count" id="count"></span>
</div>

<table>
  <thead><tr>
    <th></th>
    <th>阶段</th>
    <th data-k="tier">稀有度</th>
    <th data-k="name">名字</th>
    <th>属性</th>
    <th class="abil-h">特性</th>
    <th data-k="total">总计</th>
    <th data-k="hp">生命</th>
    <th data-k="atk">物攻</th>
    <th data-k="def">物防</th>
    <th data-k="spa">特攻</th>
    <th data-k="spd">特防</th>
    <th data-k="spe">速度</th>
    <th data-k="cost">花费</th>
  </tr></thead>
  <tbody id="rows"></tbody>
</table>

<footer>
  <p>共 __COUNT__ 只，__FAMS__ 条进化家族。特性一栏里 <span class="abil"><span class="hid">橙色</span></span> 是隐藏特性，<span class="abil"><span class="pas">绿色</span></span> 是用糖果解锁的被动特性。</p>
  <p><b>花费</b>：开局选人时占用的点数，预算共 10 点。只有初始阶段有花费，因为开局只能选进化链的第一只；攒该种族的糖果可以把它降下来。</p>
  <p>点表头可以排序，排序后会打散家族、按数值排名。</p>
</footer>
</div>

<script>
const TYPES = [["一般","#a8a878"],["格斗","#c03028"],["飞行","#a890f0"],["毒","#a040a0"],
  ["地面","#e0c068"],["岩石","#b8a038"],["虫","#a8b820"],["幽灵","#705898"],["钢","#b8b8d0"],
  ["火","#f08030"],["水","#6890f0"],["草","#78c850"],["电","#f8d030"],["超能","#f85888"],
  ["冰","#98d8d8"],["龙","#7038f8"],["恶","#705848"],["妖精","#ee99ac"]];

const ATLASES = __ATLASES__;
// [name, types, abilities, hidden, passive, stats, cost, depth, [atlas,x,y,w,h]]
const FAMS = __DATA__;

const MAXSTAT = 255;
const typeSelect = document.getElementById("type");
TYPES.forEach(([n], i) => typeSelect.insertAdjacentHTML("beforeend", '<option value="' + i + '">' + n + '</option>'));

function stageLabel(depth, maxDepth) {
  if (maxDepth === 0) return ["单阶段", ""];
  if (depth === 0) return ["初始", "s0"];
  if (depth === maxDepth) return ["终极", "s2"];
  return ["中级", "s1"];
}

const KEY = {
  name: m => m[0], total: m => m[5].reduce((a, b) => a + b, 0),
  hp: m => m[5][0], atk: m => m[5][1], def: m => m[5][2],
  spa: m => m[5][3], spd: m => m[5][4], spe: m => m[5][5],
  cost: m => (m[6] === null ? 99 : m[6]),
  tier: m => (m[9] === null ? -1 : m[9]),
};

let sortKey = null;
let sortDir = 1;

function iconCell(ic) {
  if (!ic) return '<td class="icocell"></td>';
  const url = "./images/" + ATLASES[ic[0]] + ".png";
  return '<td class="icocell"><span class="ico" style="width:' + ic[3] + "px;height:" + ic[4]
    + "px;background:url(" + url + ") -" + ic[1] + "px -" + ic[2] + 'px"></span></td>';
}

const TIER_NAMES = ["普通", "稀有", "史诗", "传说"];

function row(m, maxD, famStart) {
  const name = m[0], types = m[1], abils = m[2], hidden = m[3], passive = m[4], stats = m[5], cost = m[6], depth = m[7];
  const tier = m[9];
  const stage = stageLabel(depth, maxD);
  const chips = types.map(i => TYPES[i]
    ? '<span class="chip" style="background:' + TYPES[i][1] + '">' + TYPES[i][0] + '</span>' : "").join("");
  const ab = abils.map(a => "<span>" + a + "</span>")
    .concat(hidden ? ['<span class="hid">' + hidden + "</span>"] : [])
    .concat(passive ? ['<span class="pas">' + passive + "</span>"] : [])
    .join("、");
  const total = stats.reduce((a, b) => a + b, 0);
  const cells = stats.map(v =>
    '<td class="n">' + v + '<span class="bar"><i style="width:'
    + Math.min(100, v / MAXSTAT * 100) + '%"></i></span></td>').join("");
  return '<tr class="' + (famStart ? "fam-start" : "") + '">'
    + iconCell(m[8])
    + '<td><span class="stage ' + stage[1] + '">' + stage[0] + "</span></td>"
    + "<td>" + (tier === null ? "" : '<span class="tier t' + tier + '">' + TIER_NAMES[tier] + "</span>") + "</td>"
    + '<td class="name">' + name + "</td><td>" + chips + '</td><td class="abil">' + ab + "</td>"
    + '<td class="n total">' + total + "</td>" + cells
    + '<td class="n">' + (cost === null ? "—" : cost) + "</td></tr>";
}

function render() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const t = document.getElementById("type").value;
  const onlyStarter = document.getElementById("cost").value === "starter";
  const tierFilter = document.getElementById("tier").value;

  const matches = m =>
    (!q || m[0].toLowerCase().indexOf(q) !== -1)
    && (t === "" || m[1].indexOf(Number(t)) !== -1)
    && (tierFilter === "" || m[9] === Number(tierFilter))
    && (!onlyStarter || m[6] !== null);

  const out = [];
  let shown = 0;

  if (sortKey) {
    // Sorting flattens the families: a ranking by stat is not a family listing.
    const flat = [];
    FAMS.forEach(f => { const maxD = Math.max.apply(null, f.map(m => m[7])); f.forEach(m => flat.push([m, maxD])); });
    flat.filter(e => matches(e[0])).sort((a, b) => {
      const x = KEY[sortKey](a[0]), y = KEY[sortKey](b[0]);
      return (typeof x === "string" ? x.localeCompare(y, "zh") : x - y) * sortDir;
    }).forEach(e => { out.push(row(e[0], e[1], false)); shown++; });
  } else {
    FAMS.forEach(fam => {
      if (!fam.some(matches)) return;
      const maxD = Math.max.apply(null, fam.map(m => m[7]));
      fam.forEach((m, i) => { out.push(row(m, maxD, i === 0)); shown++; });
    });
  }

  document.getElementById("rows").innerHTML = out.join("");
  document.getElementById("count").textContent = "显示 " + shown + " 只";
}

document.querySelectorAll("thead th[data-k]").forEach(th => {
  th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortKey === k) { sortDir = -sortDir; } else { sortKey = k; sortDir = k === "name" ? 1 : -1; }
    document.querySelectorAll("thead th span.dir").forEach(s => s.remove());
    th.insertAdjacentHTML("beforeend", '<span class="dir">' + (sortDir > 0 ? "▲" : "▼") + "</span>");
    render();
  });
});
["q", "type", "tier", "cost"].forEach(id =>
  document.getElementById(id).addEventListener(id === "q" ? "input" : "change", render));
document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("q").value = "";
  document.getElementById("type").value = "";
  document.getElementById("cost").value = "";
  document.getElementById("tier").value = "";
  sortKey = null;
  document.querySelectorAll("thead th span.dir").forEach(s => s.remove());
  render();
});

render();
</script>
</body>
</html>
"""

ITEMS = r"""<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>作业勇者 · 道具图鉴</title>
<style>__CSS__
  td.ic { width:52px; text-align:center; }
  td.ic img { width:32px; height:32px; image-rendering:pixelated; vertical-align:middle; }
  td.nm { font-weight:600; white-space:nowrap; }
  td.ds { white-space:normal; color:var(--ink-dim); font-size:.88rem; line-height:1.55; }
  td.gp { color:var(--ink-faint); font-size:.84rem; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>道具图鉴 · 每样东西做什么</h1>
  <p>每场战斗胜利后的三选一就是从这些里面挑。<a href="./guide.html">← 游戏指南</a> · <a href="./guide-dex.html">宝可梦图鉴 →</a></p>
  <p><b>选道具的原则：</b>前期优先拿<b>能叠加的强化</b>（同一个拿多个会累加），血线吃紧了再拿回复。这是能不能滚起雪球的分水岭。</p>
</header>

<div class="controls">
  <input type="search" id="q" placeholder="搜道具名或效果…" autocomplete="off" />
  <button id="reset">重置</button>
  <span class="count" id="count"></span>
</div>

<table>
  <thead><tr><th></th><th>名字</th><th>作用</th><th>分类</th></tr></thead>
  <tbody id="rows"></tbody>
</table>

<footer>
  <p>共 __ITEMCOUNT__ 种。名称与说明取自游戏本体的中文文案，图标就是游戏里用的那张图。</p>
</footer>
</div>

<script>
// [name, description, iconFile, group]
const ITEMS = __ITEMS__;

function render() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const out = [];
  ITEMS.forEach(it => {
    if (q && (it[0] + it[1]).toLowerCase().indexOf(q) === -1) return;
    const img = it[2] ? '<img src="./images/items/' + it[2] + '.png" alt="" loading="lazy" />' : "";
    out.push("<tr><td class=\"ic\">" + img + '</td><td class="nm">' + it[0]
      + '</td><td class="ds">' + (it[1] || "—") + '</td><td class="gp">' + (it[3] || "") + "</td></tr>");
  });
  document.getElementById("rows").innerHTML = out.join("");
  document.getElementById("count").textContent = "显示 " + out.length + " 种";
}
document.getElementById("q").addEventListener("input", render);
document.getElementById("reset").addEventListener("click", () => {
  document.getElementById("q").value = "";
  render();
});
render();
</script>
</body>
</html>
"""

dex_html = (DEX.replace("__CSS__", SHARED_CSS)
               .replace("__ATLASES__", atlas_payload)
               .replace("__DATA__", dex_payload)
               .replace("__COUNT__", str(species_total))
               .replace("__FAMS__", str(len(compact))))
io.open(os.path.join(REPO, "guide-dex.html"), "w", encoding="utf-8", newline="\n").write(dex_html)

items_html = (ITEMS.replace("__CSS__", SHARED_CSS)
                   .replace("__ITEMS__", item_payload)
                   .replace("__ITEMCOUNT__", str(len(rows))))
io.open(os.path.join(REPO, "guide-items.html"), "w", encoding="utf-8", newline="\n").write(items_html)

missing = sum(1 for f in compact for m in f if m[8] is None)
print(f"dex {len(dex_html)}B  species {species_total}  families {len(compact)}  icons missing {missing}")
print(f"items {len(items_html)}B  rows {len(rows)}  with icon {sum(1 for r in rows if r[2])}")
