<!--
SPDX-FileCopyrightText: 2026 jssyy

SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# 作业勇者（Homework Quest）

在 PokeRogue 之上加的一个家庭功能：**家长按日期排作业计划 → 孩子完成 → 只有家长能打分（1–5 星）→ 星级换成体力 → 体力才能玩游戏、也能在学习商店换蛋券。**

## 启动流程

`加载 → 过场动画 → 作业界面（主界面）→ 出发冒险`

开体力门禁时，PokeRogue 的工作室片头（`intro_dark.mp4`）不再播放——我们的过场就是开场；对原作的署名放在过场左下角「基于 PokéRogue（Pagefault Games）制作」。过场结束后黑幕**不立即散去**：先在幕后把作业界面搭好，再淡出黑幕，中间不会闪出空的标题背景（`playHomeworkIntroOnce()` 返回一个 `liftCurtain()` 交给 `TitlePhase` 调用）。

开体力门禁时，作业界面**取代标题界面**：开场动画放完（任意键跳过，每次启动只放一次）直接落到作业计划，第一行就是「出发冒险」，原来的新游戏/加载游戏/历史记录/设置都收在这一行里。家长在「家长设置」里关掉体力门禁后，回到 PokeRogue 原本的标题界面，作业界面退回菜单项。

全新存档送 30 点体力（够开一档），否则第一次打开游戏是一扇打不开的门。

界面全部按主题走，不再借 PokeRogue 的门面：

- **过场**：金色像素标题「作业勇者」+ 副标「认真写作业 · 召唤伙伴 · 出发冒险」+ **五颗星逐颗亮起**（星级就是家长打分、也是体力的来源，一张图说清整套机制）+ 三行承诺。
- **主界面头部**：体力数字旁边是一条**体力条**，白色刻度标着「开一局 = 30」，颜色按能不能出发变化（红=开不了、黄=刚够、绿=宽裕）；第二行是「今日 x/y 已评　连续 n 天　待打分 n」。
- **空计划不留空盒子**：没安排任务时，列表中央直接写清楚现在该做什么。

## 一、分数应该充当哪个游戏元素？（设计分析）

先看 PokeRogue 现成能被"分数"驱动的东西，以及各自的问题：

| 候选载体 | 吸引力 | 对平衡的影响 | 作为作业奖励的问题 |
| --- | --- | --- | --- |
| **蛋券**（`voucherCounts`，抽蛋入场券） | 高（开盲盒） | 无（不改战斗数值） | 几乎没有，已有 UI 和存档字段 |
| **糖果**（`starterData[x].candyCount`） | 中 | 间接（解锁被动/降费） | 按种族分配，小孩不易理解 |
| **一次性解锁**（无尽模式等） | 一次性高 | 中 | 只能奖励一次，长期无激励 |
| **开局金钱/道具加成** | 低-中 | 直接改平衡，越玩越简单 | 会把"做作业"变成"数值挂机" |
| **入场资源（体力）** | —（是约束不是奖励） | 控制"能玩多久" | 约束力最强，但用力过猛会连游戏一起讨厌 |

结论（本实现采用）：**分数 = 体力（既是入场券，又是商店货币）**。

- **约束侧**：开新档 30、继续存档 10、每闯过 10 波再扣 10。没写作业就没有体力，游戏打不开——这是家长要的抓手。
- **奖励侧**：同一份体力也能在「学习商店」换蛋券（60 / 150 / 400）或糖果雨（80）。于是孩子每天要**自己做一个决策**：今天挣的体力是拿去多玩几波，还是攒着换特级蛋券？这个取舍才是让分数变成"游戏元素"的关键，而不是单纯的惩罚计量器。
- **不碰战斗平衡**：体力只决定"能不能玩、能玩多久"，商店只卖蛋券和糖果，不卖战斗力。孩子不会因为作业写得多就把游戏玩成无脑碾压。

### 为什么星级要用凸曲线

`1★=2、2★=5、3★=10、4★=18、5★=30`。五次 1 星（10 点）远不如一次 5 星（30 点）。主题是"**认真**做作业"，所以数值必须让"认真写一项"比"糊弄五项"更划算，否则孩子会去刷任务数量。这也是"只有家长能打分"的意义：打分权在家长手里，分数才代表质量而不是自我申报。

### 防挫败的三个设计闸门

硬门禁最大的风险是孩子把游戏和作业一起恨上，所以：

1. **体力耗尽绝不弄丢进度**。波次收费付不出时，游戏走和「保存并退出」完全相同的存档路径，回到标题；作业做完就能接着打（会重打当前这一波）。见 `src/system/homework-gate.ts` 的 `saveAndQuitOutOfStamina`。
2. **不做"断签清零"**。连续天数只在完成日累加；没排计划的日子是中性的（周末不排计划不算断），排了没做完才断。
3. **家长有豁免开关**。「今天免体力」（生病/放假）和「体力门禁开/关」都在家长设置里，随时可退。

## 二、数值表

| 项目 | 数值 |
| --- | --- |
| 全新存档赠送 | 30 |
| 星级换体力 | 1★=2、2★=5、3★=10、4★=18、5★=30 |
| 当日必做全部打分 | +10 |
| 当日必做平均 ≥4★ | 再 +20 |
| 连续天数奖励 | 每天 +3，最多按 7 天算 |
| 逾期打分（超过计划日 1 天以上） | 星级体力 ×0.5 |
| 开新档 / 继续存档 | 30 / 10 |
| 波次收费 | 每 10 波 10 |
| 商店 | 普通蛋券 60、高级 150、特级 400、糖果雨 80 |

一天认真做 3 项 5 星 ≈ 90+10+20+3 = **123 点**：够开一档（30）打到 40 波左右（30），再攒下一张普通蛋券。数值都集中在 `src/system/homework-config.ts`，按孩子的实际情况直接改。

## 三、怎么用

**家长第一次**：进「作业勇者」→ 菜单… → 家长模式 → **初始密码 1234** → 家长设置 → 修改家长密码。

- **排计划**：左右键切换日期 → 菜单… → 新建任务 → 选科目 → 选预置任务（或"自己写标题"）→ 必做/选做。「复制昨天的计划」一键复制。
- **打分**：家长模式下选中任务 → 给这项打分 → 选星级。打错了可以重新打分，只补差额，不会重复发全天奖励。
- **必做 vs 选做**：只有"必做"参与当天完成判定和连续天数；"选做"只发自己那份星级体力。

**孩子**：选中任务 →「我做完了」（状态变"待评"），等家长打分。孩子无法给自己打分，也无法撤销已打分的任务。

## 四、代码结构

| 文件 | 职责 |
| --- | --- |
| `src/system/homework-data.ts` | 全部规则：星级换算、当日奖励、连续天数、体力收支、PIN、存档校验。不依赖 Phaser，便于单测 |
| `src/system/homework-config.ts` | 所有可调数值与任务模板 |
| `src/system/homework-date.ts` | 本地日期键（`YYYY-MM-DD`）工具，跨夏令时安全 |
| `src/system/homework-manager.ts` | localStorage 持久化（独立键 `homeworkQuest_<用户名>`，不进 PokeRogue 云存档，避免互相覆盖） |
| `src/system/homework-gate.ts` | 体力门禁：开档/继续/波次收费、体力耗尽时安全保存退出 |
| `src/system/homework-shop.ts` | 学习商店（发蛋券、糖果雨），先发货再扣费 |
| `src/system/homework-locales.ts` | 中英文案（`locales/` 是上游子模块，所以文案用 `addResourceBundle` 从代码注册） |
| `src/system/homework-intro.ts` | 开场过场动画（标题 + 五星逐颗亮起 + 承诺 + 署名），任意键跳过；异常和超时都会自动放行，不会把玩家卡在黑屏 |
| `src/ui/handlers/homework-ui-handler.ts` | 计划界面（周条 + 任务列表 + 页脚提示 + 各级菜单），也充当主界面 |
| `src/ui/handlers/homework-pin-form-ui-handler.ts` | 家长 PIN 弹窗 |
| `src/ui/handlers/homework-task-form-ui-handler.ts` | 自定义任务标题输入 |

> 菜单项的铁律：每个 option 的 handler **要么关闭菜单，要么再开一层**。两者都不做的话，option-select 会把自己清空却仍然是当前模式，整个界面就此卡死（「我的账本」曾经踩过这个坑，已加回归测试）。

接入点只有六处：`src/enums/ui-mode.ts`、`src/ui/ui.ts`（注册 handler + 免过渡）、`src/phases/title-phase.ts`（入口 + 开档/继续门禁）、`src/phases/new-battle-phase.ts`（波次收费）、`src/ui/handlers/menu-ui-handler.ts`（游戏内菜单入口）、`src/loading-scene.ts`（跳过工作室片头）。

## 五、跑起来与性能

开发用 `pnpm start:dev`（8000 端口）；**给孩子玩要用构建版**：`pnpm build` 生成 `dist/`，再 `pnpm preview --port 8001`（`.claude/launch.json` 里已配好 `pokerogue-built`）。开发服务器不打包、几千个模块逐个转译，比构建版慢一个量级。

加载慢的大头是 PokeRogue 本身要拉几千个精灵/图集/JSON，浏览器每域名只并发 6 个连接，**冷缓存的第一次必然慢**；之后有 Service Worker 和浏览器缓存兜着，重开会快很多。

已修的一处真浪费：加载画面原本每完成一个文件就重绘一次「加载资源：xxx」和百分比，而 Phaser 的 `setText` 每次都要重新光栅化并上传一张 GPU 纹理——一万多个文件就是一万多次上传。现在文字最多 100ms 更新一次、百分比只在数字变化时更新，进度条（矢量绘制，便宜）仍逐帧更新。

> 量帧率时注意：标签页切到后台，浏览器会暂停 `requestAnimationFrame`，测出来的数字全是假的。

测试：`test/tests/system/homework-data.test.ts`（经济规则）、`test/tests/system/homework-date.test.ts`（日期）、`test/tests/ui/homework.test.ts`（真实场景下开界面、孩子提交、家长 PIN 打分、门禁与波次收费）。

> 注意：测试框架默认关闭体力门禁（`test/framework/game-manager.ts`），否则任何跑过 10 波的既有测试都会被收费卡住。

## 游戏指南（离线网页）

三张独立网页，随游戏一起构建、一起部署，不联网：

| 文件 | 内容 |
| --- | --- |
| `guide.html` | 上手手册。体力规则、一局流程、战斗、属性相克全表、能力值、特性、成长路径、道具、捕获、蛋与糖果、存档规则、家长指南、常见问题 |
| `guide-dex.html` | 1084 只宝可梦，按 571 条进化家族排成「初始 → 中级 → 终极」，带图标、属性、特性、六项能力值与开局花费；可搜索、筛选、按列排序 |
| `guide-items.html` | 92 种道具的图标、名称与作用 |

入口有两处，都调用 `window.open(GUIDE_URL)`（`src/system/homework-config.ts`）：计划表的「菜单… → 游戏指南」，以及游戏内菜单的「游戏指南」。三张页面都在 `vite.config.ts` 的 `rolldownOptions.input` 里注册，否则构建只会打包 `index.html`。

图片不复制一份：宝可梦用 `./images/pokemon_icons_N.png` 图集按坐标切片，道具直接引 `./images/items/*.png`，都是游戏本来就在提供的路径。

### 重新生成图鉴页

数据不是从源码解析的，而是**从跑起来的游戏里读**——这样名字、数值和道具文案就与玩家看到的完全一致，语言也跟着游戏走。跑开发服务器，在游戏加载完成后的控制台执行：

```js
// 1) 物种与进化链
const { speciesDataRegistry: reg } = await import("/src/globals/global-species-data-registry.ts");
const { SpeciesId } = await import("/src/enums/species-id.ts");
const { allAbilities, modifierTypes } = await import("/src/data/data-lists.ts");
const abName = a => allAbilities[a]?.name ?? "";
const seen = new Map();
for (const id of Object.values(SpeciesId).filter(v => typeof v === "number")) {
  let s; try { s = reg.getSpecies(id); } catch { continue; }
  if (!s) continue;
  const d = reg.getSpeciesData(id);
  seen.set(id, { id, n: s.getName(), t: [s.type1, s.type2].filter(t => t != null),
    a: [...new Set([s.ability1, s.ability2].filter(Boolean))].map(abName),
    h: s.abilityHidden ? abName(s.abilityHidden) : "", p: d.passives ? abName(d.passives) : "",
    tier: d.eggTier ?? null,
    s: s.baseStats.slice(), c: d.starterCost ?? null, pre: d.prevolution ?? null,
    evo: (d.evolutions ?? []).map(e => ({ to: e.speciesId })) });
}
const families = [];
for (const [id, e] of seen) {
  if (e.pre != null) continue;
  const chain = [];
  (function walk(nid, depth) {
    const node = seen.get(nid); if (!node || depth > 4) return;
    chain.push({ ...node, depth });
    for (const nx of node.evo) walk(nx.to, depth + 1);
  })(id, 0);
  if (chain.length) families.push(chain);
}

// 2) 图标坐标与道具
const icons = {};
for (const id of seen.keys()) { const s = reg.getSpecies(id); icons[id] = [s.getIconAtlasKey(), s.getIconId(false)]; }
const items = Object.keys(modifierTypes).map(k => {
  try { const t = modifierTypes[k](); return t && { k, name: t.name ?? "", desc: t.description ?? "", icon: t.iconImage ?? "", group: t.group ?? "" }; }
  catch { return null; }
}).filter(Boolean);

copy(JSON.stringify({ families }));            // 存成 dex.json
copy(JSON.stringify({ icons, items }));        // 存成 extra.json
```

把两个文件放同一个目录，然后：

```bash
python scripts/build-guide-pages.py <那个目录>
```

会就地覆盖 `guide-dex.html` 和 `guide-items.html`。`guide.html` 是手写的，不由脚本生成。

> `passives` 和 `eggTier` 都只登记在进化链的**第一阶段**上，后面的阶段读出来是空的。生成脚本会把它们沿家族往下继承——这两项描述的本来就是整条线：被动是用糖果为该种族解锁的，稀有度是扭蛋池的档位，而蛋孵出来一定是第一阶段。

## 怎么带账号启动

`pnpm start:dev` **不会**出现登录界面：`.env.development` 里 `VITE_BYPASS_LOGIN=1`，那是上游给纯本地开发用的模式，账号、云存档、家长身份全都不参与。带账号玩要用 `family` 模式。

两个终端：

```bash
# ① 账号服务（默认 8001，数据在 server/data/）
cd server && npm start

# ② 游戏（默认 8000，登录不跳过，指向 localhost:8001）
pnpm start:family
```

**在游戏里注册的第一个账号会成为家长账号**，之后的孩子账号由家长在游戏内创建，没有自助注册。

| 模式 | 命令 | 登录 | 服务端 |
| --- | --- | --- | --- |
| 家庭（要用的） | `pnpm start:family` | 需要 | `localhost:8001` |
| 上游本地开发 | `pnpm start:dev` | **跳过** | 不连 |
| 上游线上 | `pnpm start:prod` | 需要 | `api.pokerogue.net` |

构建同理：`pnpm build:family`。`.env.family` 是我们加的，上游的四个 env 文件一个都没动。

> 端口被占用时 Vite 会自己往后找（8000 被占就用 8002 之类），启动日志里会写实际地址——看那一行，不要想当然。

## 跟上游保持同步

上游（`pagefaultgames/pokerogue`）的玩法一直在更新，这个分支要定期把它拉进来。

```bash
git fetch origin beta
git merge origin/beta
npx tsc --noEmit -p tsconfig.json
npx vitest run test/tests/ui test/tests/system
git push fork feat/homework-quest
```

**用 merge，不要 rebase。** 这个分支已经推到 fork 上，rebase 会重写历史；而且冲突真出现时，merge 只需要解一次，rebase 要在每个提交上重解一遍。

**别往上游提 PR。** 这是家用改版，`origin` 只用来拉取。推送一律推 `fork`。

### 为什么合并一直很轻松

改动的形状决定了合并成本，不是改动的大小：

| | 数量 | 会不会冲突 |
| --- | --- | --- |
| 新增文件 | 27 个、6000 多行 | 永不冲突 |
| 修改上游文件 | 22 个、约 +535 / −74 行 | 只有这些会 |

上游最近一次更新动了 107 个文件，其中 4 个我们也碰过（`battle-scene`、`loading-scene`、`title-phase`、`ui`），**全部自动合并成功**——因为我们在这些文件里放的是几行长的钩子，不是重写。

### 上游文件的改动点

新功能尽量继续走「新文件 + 一个几行的钩子」，这张表就不会变长，合并也就一直便宜。

| 文件 | 改动 |
| --- | --- |
| `src/ui/battle-info/battle-info.ts` | +109 / −16 |
| `src/phases/title-phase.ts` | +77 / −4 |
| `src/ui/containers/starter-summary.ts` | +54 / −7 |
| `src/ui/handlers/menu-ui-handler.ts` | +50 / −3 |
| `src/i18n.ts` | +44 / −0 |
| `src/loading-scene.ts` | +34 / −3 |
| `src/ui/text.ts` | +33 / −0 |
| `src/ui/handlers/party-ui-handler.ts` | +27 / −7 |
| `src/battle-scene.ts` | +20 / −3 |
| `src/ui/ui.ts` | +19 / −1 |
| `src/main.ts` | +10 / −0 |
| `src/enums/ui-mode.ts` | +9 / −0 |
| `vite.config.ts` | +8 / −0 |
| `src/phases/new-battle-phase.ts` | +7 / −0 |
| `index.css` | +5 / −0 |
| `src/ui/containers/starter-container.ts` | +4 / −2 |
| `src/ui/battle-info/player-battle-info.ts` | +4 / −16 |
| `test/mocks/mocks-container/mock-input-text.ts` | +4 / −0 |
| `test/mocks/mocks-container/mock-container.ts` | +4 / −0 |
| `test/framework/game-manager.ts` | +4 / −0 |
| `src/init/init.ts` | +2 / −0 |
| `src/ui/battle-info/enemy-battle-info.ts` | +1 / −2 |

冲突真发生时，绝大多数会落在这几个大头上：`battle-info.ts`（字体与数值排版）、`title-phase.ts`（作业主界面接管标题）、`menu-ui-handler.ts`（菜单项）。这三处的改动意图都写在各自的注释里，照着重新套用即可。

> 子模块（`assets/`、`locales/`）由上游管理，我们从不提交进去；合并后如果 `git status` 显示子模块有变化，用 `git submodule update --init` 对齐即可。

## 账号体系（家长建号 / 存档不丢）

存档原本只在浏览器里，清缓存或换设备就没了。`server/` 是补上这一环的服务，见 `server/README.md`。

### 权限怎么划

**登录身份决定一切，PIN 降级为脱机兜底：**

```
可用家长工具 = 已登录 ? (role === 'parent') : PIN 已解锁
```

孩子登录时，家长模式、家长设置、打分**整项不渲染**——不存在的菜单项没法被猜到，而 PIN 输入框可以被在旁边看着。家长登录时工具直接可用，登录已经验过身份，再问一次 PIN 是做样子。不联网时没有账号可问，PIN 照旧生效。

### 体力为什么要分成两半

藏起菜单不等于防住。体力是浏览器算的，会按 F12 的孩子改一下数字就凭空得到体力。所以**按有没有作弊动机切开**：

| | 归属 | 理由 |
| --- | --- | --- |
| 赚到的（`totalEarned`） | **服务端** | 只有家长身份的请求能写。这才让「分数 = 有大人看过」成立 |
| 花掉的（`totalSpent`） | 客户端 | 花自己的余额只会变少，没有说谎的收益；留在本地才能在服务器关着时继续玩 |

余额 = 服务端 `earned` − 本地 `totalSpent`。迎新的 30 点由服务端在建号时发放，客户端从不铸币，账上每一笔进账都能追溯到家长的某个动作。

打分时本地规则引擎照常算（调参表在游戏里），把 `totalEarned` 的增量提交给服务端。**提交失败不用回滚**——下次同步时服务端的数字会覆盖本地，乐观增加自动被纠正。

### 家长在自己设备上批改

家长自己的计划是空的，所以家长会话编辑的是**某个孩子的**计划：菜单里的「切换孩子」拉 `/family/children`，选中后 `homeworkManager.viewChild(id)` 把计划表指过去，之后的读写都带 `?account=<孩子id>`。

### 建号在网页上做，不在游戏里

`server/public/admin.html`，服务根路径就是它。建号要打字，网页比像素弹窗合适得多，代码也少一个数量级。第一个注册的账号成为家长，之后注册接口关闭。

### 已知的取舍

- **两台设备同时改同一份计划不合并**，后推的覆盖先推的。一个家庭里这是比「谁也说不清的合并引擎」更诚实的选择。
- **会话不过期**。家里网络中，会话过期的代价是孩子玩不了要等家长，比它防住的风险更糟。
- **发放数量由客户端给，服务端不重算星级曲线**。要防的是孩子不是家长——家长本来就能直接赠送体力；服务端重算只会让调参表存在两处、必须同步部署。
