"""Crops the starter-screen captures and embeds them into guide.html as data URIs.

Inline rather than files on disk: `guide.html` sits at the repo root and the build only copies the
game's own asset tree, so a separate image would need a build rule to survive. Pixel art quantises
to a small palette with no visible loss, which is what keeps the page a sensible size.
"""

import base64
import io
import os
import re

from PIL import Image

import sys

# Directory holding the captures, and the page to inject them into.
SHOTS = sys.argv[1] if len(sys.argv) > 1 else "."
GUIDE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "guide.html")

# The filter bar and whatever dropdown is open below it; the left panel and the empty grid are cropped
# away because they carry nothing the caption is talking about.
CROP = (300, 0, 1920, 640)
SCALE = 2


def encode(name: str) -> str:
    img = Image.open(os.path.join(SHOTS, name)).convert("RGB").crop(CROP)
    img = img.resize((img.width // SCALE, img.height // SCALE), Image.LANCZOS)  # noqa: keeps pixels legible
    img = img.quantize(colors=192, method=Image.MEDIANCUT)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


FIGURES = [
    ("f-gen.png", "世代", "按宝可梦所属的世代（I–IX）筛选。想只看初代的，勾 I。"),
    ("f-caught.png", "捕获", "按你和它的关系筛：还没抓到的、抓到过的、以及三档异色。"),
    ("f-unlocks.png", "解锁", "按糖果解锁进度筛：被动特性和花费减免，各自可以要「已解锁」「可解锁」「还没解锁」。"),
    ("f-misc.png", "混合", "杂项开关：收藏、通关过、隐藏特性、能用蛋券换、宝可露丝。"),
    ("f-sort.png", "排序", "换排列顺序：编号、花费、糖果数、个体值、名字、捕获数、孵化数。"),
]

html = io.open(GUIDE, encoding="utf-8").read()

figures = []
for name, title, caption in FIGURES:
    data = encode(name)
    figures.append(
        f'  <figure class="shot">\n'
        f'    <img src="data:image/png;base64,{data}" alt="选宠界面的「{title}」筛选页" loading="lazy" />\n'
        f"    <figcaption><b>{title}</b>　{caption}</figcaption>\n"
        f"  </figure>"
    )

section = """
<!-- starter filters -->
<section id="starter">
  <h2>选宠界面的六个筛选页</h2>
  <p class="lede">开局那一屏顶上有一排：<b>世代 · 属性 · 捕获 · 解锁 · 混合 · 排序</b>。它们不改变游戏，只决定下面那张网格显示哪些宝可梦、按什么顺序排。</p>

  <div class="note">
    <strong>怎么操作：</strong>把光标往上移到这一排，左右选栏目，<kbd>确定</kbd> 展开，上下选条目，再按 <kbd>确定</kbd> 切换该条目的状态。同一栏里可以同时勾多个。
  </div>

  <h3>每一栏是什么</h3>
  <table>
    <thead><tr><th>栏目</th><th>作用</th></tr></thead>
    <tbody>
      <tr><td><b>世代</b></td><td>宝可梦出自第几世代，I 到 IX。</td></tr>
      <tr><td><b>属性</b></td><td>按 18 种属性筛，草、火、水……双属性的两边都算。</td></tr>
      <tr><td><b>捕获</b></td><td>你和它的关系：<b>还没抓到</b>、<b>已抓到</b>，以及<b>三档异色</b>（异色分三个稀有度，图标颜色不同）。</td></tr>
      <tr><td><b>解锁</b></td><td>糖果花掉的进度：<b>被动特性</b>和<b>花费减免</b>，每项都能筛「已解锁 / 可解锁 / 还没解锁」。<b>「可解锁」最有用——它列出糖果已经攒够、就差你去点一下的那些。</b></td></tr>
      <tr><td><b>混合</b></td><td>五个杂项开关：<b>收藏</b>、<b>通关过</b>（拿过缎带）、<b>隐藏特性</b>、<b>能用蛋券换</b>、<b>宝可露丝</b>（每天轮换的三只，成长速度翻倍）。</td></tr>
      <tr><td><b>排序</b></td><td>只改顺序不改内容：编号、花费、糖果数、个体值、名字、捕获数、孵化数。</td></tr>
    </tbody>
  </table>

  <div class="note">
    <strong>最实用的两个用法。</strong>其一：<b>解锁 → 被动特性 → 可解锁</b>，一眼看出哪些宝可梦的糖果已经够了。其二：<b>排序 → 个体值</b>，从孵蛋攒下的好个体里挑开局队伍。
  </div>

  <h3>界面长什么样</h3>
__FIGURES__
</section>
"""

section = section.replace("__FIGURES__", "\n".join(figures))

# Styles for the figures, added once next to the other content rules.
style_anchor = "  footer { border-top: 1px solid var(--line);"
style = """  .shot { margin: 18px 0 24px; }
  .shot img { width: 100%; border: 1px solid var(--line); border-radius: var(--radius); display: block; image-rendering: pixelated; }
  .shot figcaption { color: var(--ink-dim); font-size: .88rem; margin-top: 8px; }
  .shot figcaption b { color: var(--accent-soft); }

"""
assert style_anchor in html
html = html.replace(style_anchor, style + style_anchor, 1)

# Sits after the run overview, since it describes the screen the player meets first.
anchor = "<!-- 4 -->\n<section id=\"battle\">"
assert anchor in html, "battle section anchor not found"
html = html.replace(anchor, section.strip() + "\n\n" + anchor, 1)

# Nav entry, in the same position.
nav_anchor = '    <li><a href="#battle">战斗：四个指令</a></li>'
assert nav_anchor in html
html = html.replace(nav_anchor, '    <li><a href="#starter">选宠界面的六个筛选</a></li>\n' + nav_anchor, 1)

io.open(GUIDE, "w", encoding="utf-8", newline="\n").write(html)
print(f"guide.html now {len(html) // 1024} KB, {len(figures)} figures embedded")
