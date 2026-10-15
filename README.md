<div align="center">

<img src="docs/banner.svg" alt="龙珠爆裂大战 · 战斗排序器" width="100%">

# 龙珠爆裂大战 · 战斗排序器

**把「这一回合该让谁上场、下一回合会轮到谁」一次算清楚。**

7 人队伍的循环槽位推演 · 拖拽改序连锁重算 · 拖到指定回合自动反推前置排序 · 1458 张全角色中文图鉴

[![CI](https://github.com/xingxie175185157-code/dokkan-battle-sorter/actions/workflows/ci.yml/badge.svg)](https://github.com/xingxie175185157-code/dokkan-battle-sorter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](#-零依赖)
[![Pages](https://img.shields.io/badge/demo-GitHub%20Pages-ff8a00.svg)](https://xingxie175185157-code.github.io/dokkan-battle-sorter/)

[在线体验](https://xingxie175185157-code.github.io/dokkan-battle-sorter/) · [使用说明](#-使用说明) · [数据说明](#-图鉴数据) · [参与开发](#-参与开发)

</div>

---

## 这是什么

《七龍珠爆裂激戰》/《龙珠爆裂大战》（Dragon Ball Z: Dokkan Battle）的战斗里，一支 7 人队伍
每回合只有 **连续 3 个槽位** 的人出场，起始槽位每回合后移 3 格，7 回合一个循环。
手动心算「第 8 回合谁能上、想让 XX 第 8 回合上场前面该怎么调」非常痛苦。

这个工具把它变成可视化操作：

- 填入 7 人 → 一次列出**任意回合数**的出场顺序
- 每回合 3 人可以**拖动换位**，改动会**连锁重算之后所有回合**
- 想把某个角色放到**指定回合的指定位置**？拖过去，程序**自动反推出前面需要怎么调**
- 做不到的时候**明确拒绝并告诉你原因**，不给你一个「以为成功其实失败」的结果

---

## 功能特性

| | 功能 | 说明 |
|---|---|---|
| 🔁 | **循环槽位推演** | 默认 5 回合，回合数可改，可无限往下继续推 |
| 🖱️ | **回合内拖拽改序** | 同一回合 3 人任意换位，后续回合连锁重算，历史回合保持不变 |
| 🎯 | **拖到指定回合（反推）** | 拖到目标回合的任意格子，自动算出前置调整，并**尽量推迟改动**到最靠后的回合 |
| 🚫 | **不可行即拒绝** | 显示禁止光标 + 实时说明原因（角色当时只可能在哪些槽位） |
| ⭐ | **收藏到「我的」** | 图鉴卡一键收藏，实心 ★ 高亮显示，可取消 |
| 📖 | **1458 张全角色图鉴** | 中文名、属性、稀有度、链接技能、分类、头像、详情弹窗 |
| 🔍 | **搜索与筛选** | 按名称搜索，按属性 / 稀有度筛选 |
| 🌐 | **中 / 英 / 中英 三档显示** | 标题栏一键循环切换，不藏任何信息 |
| 💾 | **本地持久化** | 队伍、预设库、语言偏好存 localStorage，关掉再开还在 |
| 📦 | **导入 / 导出** | 预设库 JSON 导入导出，方便备份与跨设备迁移 |
| 🧩 | **零依赖零构建** | 单文件 `index.html` + 数据文件 `roster.js`，双击即用 |

---

## 快速开始

### 方式一：直接打开（最简单）

下载或克隆本仓库，双击 `index.html` 即可。无需安装、无需服务器、无需联网（图鉴头像除外）。

### 方式二：本地 http 服务

```bash
npm run serve          # → http://127.0.0.1:8080/
npm run serve 3000     # 指定端口
```

### 方式三：在线使用

打开 <https://xingxie175185157-code.github.io/dokkan-battle-sorter/>

### 方式四：clone 一份自己改

```bash
git clone https://github.com/xingxie175185157-code/dokkan-battle-sorter.git
cd dokkan-battle-sorter
npm install            # 仅测试需要（jsdom），应用本体零依赖
npm test
```

---

## 使用说明

### 一、槽位轮转规则

7 个槽位，每回合取**连续 3 个**上场，起始槽位每回合后移 3 格。周期为 **7 回合**：

| 回合 | 上场槽位 | 回合 | 上场槽位 |
|:---:|:---:|:---:|:---:|
| 1 | **1 · 2 · 3** | 5 | **6 · 7 · 1** |
| 2 | **4 · 5 · 6** | 6 | **2 · 3 · 4** |
| 3 | **7 · 1 · 2** | 7 | **5 · 6 · 7** |
| 4 | **3 · 4 · 5** | 8 | **1 · 2 · 3** ↺ |

> 起始槽位 = `(3 × (回合号 - 1)) mod 7`。第 8 回合与第 1 回合完全一致，之后循环。

**关键推论**：相邻两回合的上场窗口**完全不重叠**（1-2-3 → 4-5-6 → 7-1-2 …），
所以「第 2 回合要上的人，第 1 回合根本碰不到」。这是所有排布约束的根源。

### 二、填人与改序

1. 左侧「**图鉴**」搜索角色，点 `＋` 加入队伍空位（或直接拖进队伍格）
2. 「**我的**」页签可自建角色，也保存从图鉴收藏来的卡
3. 中间「**队伍初始顺序**」可拖拽调整 7 个槽位的初始归属
4. 右侧「**回合推演**」列出每回合的 3 人，**拖动卡片即可在本回合内换位**

> 改序的本质是**交换这三人的槽位归属**，因此之后所有回合都会连锁重算；
> 已经过去的回合显示保持不变（不会被后续改动倒灌）。

### 三、拖到指定回合（自动反推）

把任意角色（图鉴卡 / 我的卡 / 队伍格 / 牌序条 / 其他回合的卡）**拖到目标回合的某一格**：

- **可行** → 自动调整前置回合，然后：
  - 被自动调整的格子标 **「前置调整」**（金色）
  - 目标格标 **「目标位」**（绿色）
  - 9 秒后自动淡出，你一动手改序就立即清除
- **不可行** → 拖拽时显示**禁止光标**，底部提示条实时说明原因：

  > 不可行：超级赛亚人3孙悟空 在第 1 回合开始前只可能位于槽 5，而该回合上场的是槽 1 / 2 / 3。

反推算法会**尽量把改动推迟到最靠后的回合**，能不动你前面的排布就不动。
拖进来的角色若不在队伍里且有空位，会**自动补进队伍**（只填空位，保留你已有排布）。

### 四、其它

- **语言**：标题栏语言按钮循环 `中文 → English → 中英`
- **回合数**：右侧输入框改回合数，或点「继续推演」往下加
- **导出 / 导入**：把预设库导出为 JSON，可在别的设备导入
- **帮助**：标题栏 `?` 查看内置说明

---

## 图鉴数据

1458 张角色卡，字段：中文名、英文名、称号、稀有度、属性、类别、头像、链接技能、分类、实装日期。

```
角色名中文化    1458 / 1458  = 100%
链接技能         133 / 133   = 100%
分类              99 / 99    = 100%
稀有度分布      LR 198 / UR 829 / SSR 122 / SR 160 / R 113 / N 36
```

**中文怎么来的**（这游戏**没有中文维基 / 中文数据库**，是三层拼出来的）：

| 层级 | 做法 | 覆盖 |
|---|---|---|
| 链接技能、分类 | 取官方**繁体中文**名表转简体 | 100% |
| 角色名 | 约 350 条术语表，按「最长优先 + 字母数字边界」逐词对照替换 | 100% |
| 角色称号 | 卡面 flavor text（1390 条几乎不重复），**保留英文** | — |

⚠️ 角色名为**算法生成**，与游戏内文本可能存在出入（尤其意译名、地区译名分歧）。
以游戏内实际文本为准，欢迎提 Issue 修正译名。

**数据来源**：[DOKKAN.FYI](https://dokkan.fyi)（非官方粉丝资料站，其 `robots.txt` / `llms.txt`
允许自动化读取公开页面）。图像为**第三方 CDN 外链**，本仓库不存储任何图片。

> 📄 详细的权利归属、商标声明与合规说明见 **[NOTICE.md](NOTICE.md)**。

---

## 项目结构

```
dokkan-battle-sorter/
├── index.html              # ★ 整个应用：引擎 + 界面 + 样式（单文件，零依赖）
├── roster.js               # ★ 图鉴数据（1458 张，由管线生成，需与 index.html 同目录）
├── data/
│   ├── raw-roster.json     # 抓取产物（英文原始数据）
│   ├── enums-en.json       # 链接技能 / 分类枚举（133 / 99）
│   ├── report.txt          # 构建报告（中文化残留检查）
│   └── cache/              # 抓取缓存（已 gitignore，可重新生成）
├── tools/
│   ├── crawl.mjs           # 抓取：dokkan.fyi → data/raw-roster.json
│   ├── build-zh.mjs        # 构建：原始数据 + 词典 → roster.js
│   ├── i18n-zh.json        # 中英对照主词典（链接 / 分类 / 名字术语）
│   └── serve.mjs           # 零依赖本地静态服务器
├── tests/
│   ├── check.js            # 引擎回归（73 项）
│   ├── verify.mjs          # 端到端静态校验（36 项）
│   └── dom.mjs             # 真实 jsdom 页面加载与交互（40 项）
├── docs/banner.svg         # README 横幅
├── .github/                # CI / Pages / Issue / PR 模板
├── LICENSE                 # MIT（仅覆盖代码）
└── NOTICE.md               # 第三方数据与商标声明
```

---

## 参与开发

### 环境

- Node.js **≥ 18**（`tests/verify.mjs` 用到内置 `fetch`）
- 应用本体**零依赖**；仅 jsdom 测试需要 `npm install`

### 测试

改完代码**三套测试都要跑**：

```bash
npm test              # 全部

npm run test:engine   # 引擎回归 73 项：槽位轮转 / 连锁重算 / 反推可行性 / 冗余不变量
npm run test:static   # 静态校验 36 项：DOM id 契约 / 字段完整性 / 索引解析 / 数据一致性
npm run test:dom      # 真实页面 40 项：jsdom 加载无报错 / 图鉴渲染 / 收藏 / 四种拖拽 / 拒绝不可行
```

CI 在每次 push 与 PR 上跑同样的三套（见 `.github/workflows/ci.yml`）。

### 数据管线

```bash
npm run crawl     # 抓取 dokkan.fyi → data/raw-roster.json + data/enums-en.json
npm run build     # 词典中文化 → roster.js + data/report.txt
npm run rebuild   # 上面两步一起
```

想修译名：改 `tools/i18n-zh.json` 后 `npm run build` 即可，无需重新抓取。
`data/report.txt` 会列出**未被词典覆盖的英文残留**，是补词表的主要线索。

### 关键不变量

改引擎时请守住这几条，它们都有对应回归用例：

1. 回合卡片**渲染必须读快照** `state.turns[t]`，不能读 `state.deck`
2. 要把某回合排布写回牌序，必须用 `deckAt(k)` 从 `state.team` **重放历史快照**重建，
   直接读 `state.turns[k]` 会在跨回合改序时**丢人 + 造重复**
3. 新增引擎函数要写在 `function startSlot` 与 `渲染：预设库` 之间（测试按此切片提取引擎）
4. 读取队伍成员一律用 `resolve()` / `nameOf()` / `typeOf()` / `dispName()`（统一 key：
   图鉴 `r:<id>`、自建 `p:<id>`）；`byId()` 只适用于自建卡的编辑 / 删除路径
5. 角色 key 格式：`"r:<图鉴id>"` / `"p:<自建id>"`，旧裸 id 视为自建卡（向后兼容）

### 对外接口

`window.DokkanSorter`（版本 `2.1.0`）：

```js
getRoster()                    // 图鉴数组
rosterSize() / isRosterReady()
searchRoster(keyword, opts)    // 搜索图鉴
card(key)                      // 统一 key → 卡对象
setTeamByRosterIds(ids)        // 按图鉴 id 设队伍
setTeamByNames(names)          // 按名字设队伍
getState()                     // { team, deck, turns, turnCount }
getPlan(key, turn, pos)        // 反推试算（纯函数，无副作用）
setTurnCount(n) / rebuild() / render()
addPresets(list) / removePreset(id)
getNameMode() / setNameMode('zh'|'en'|'both')
```

`addPresets()` 支持批量导入，可作为从其它来源补数据的入口。

---

## 数据来源与免责声明

- 程序代码：**MIT**（见 [LICENSE](LICENSE)）
- 游戏资料数据：整理自第三方站点 [DOKKAN.FYI](https://dokkan.fyi)，**权利归原权利方**，
  本仓库不主张任何权利；可随时移除，也可自行重新抓取生成
- 角色图像：**第三方 CDN 外链**，本仓库不存储、不再分发
- 《龙珠》系列及相关名称、角色、图像为株式会社万代南梦宫娱乐 / 集英社等权利方的商标

本项目为**非商业性质的粉丝工具**，与上述权利方**无任何关联、未获授权或背书**。
完整说明见 **[NOTICE.md](NOTICE.md)**。

---

## 许可证

[MIT](LICENSE) © 2026 dokkan-battle-sorter contributors
