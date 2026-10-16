# 参与贡献

感谢你对这个项目感兴趣！无论是修一个译名、报一个 bug，还是加一个功能，都欢迎。

---

## 最快的贡献方式：修正译名

这游戏**没有中文维基 / 中文数据库**，角色名是由 `tools/i18n-zh.json` 里的术语表
**逐词对照生成**的，所以「某个角色名和游戏里不一样」通常只需要改几条词条。

```bash
# 1. 打开 tools/i18n-zh.json，找到对应词条改名
#    文件分四段：types / typeKeys / links / categories / nameTerms

# 2. 重新生成 roster.js
npm run build

# 3. 看构建报告，确认没有新增英文残留
cat data/report.txt
```

**只改词典就能修好，不需要重新抓取数据。**

改完后请一并提交 `roster.js` 与 `data/report.txt`（CI 会校验生成物同步）。

> 注意「最长优先」规则：`Master Shen`（鹤仙人）和 `Shen`（被神附身的人类）是不同角色，
> 词表里同时存在时，长词条会自动优先匹配。补词条时留意不要破坏这个关系。

---

## 报 Bug

用 [Bug 反馈模板](../../issues/new?template=bug_report.yml)。请尽量提供：

- **具体是哪 7 个角色**（这是排布类问题能复现的关键）
- **操作顺序**（先点了什么、又拖了什么）
- 期望结果与实际结果
- 浏览器与打开方式（双击 `file://` 还是 http 服务）

如果是排布算错的问题，也可以在「导出预设库」之后把 JSON 贴进 Issue，能极大加速定位。

---

## 提功能建议

用 [功能建议模板](../../issues/new?template=feature_request.yml)。
**先讲场景和痛点，再讲方案** —— 有时候有更简单的实现方式。

---

## 提 Pull Request

```bash
git clone https://github.com/xingxie175185157-code/dokkan-battle-sorter.git
cd dokkan-battle-sorter
npm install          # 只有测试需要依赖，应用本体零依赖
npm test             # 三套测试，改完必须全绿
```

### 改代码前请先了解这几条不变量

它们看起来反直觉，但都是踩过坑之后定下来的，**都有对应的回归用例**：

**1. 回合渲染必须读快照，不能读牌序**

```js
// ✅
state.turns[t]        // 该回合的三张卡
// ❌
slotsOf(t).map(s => state.deck[s])
```

回合之间**共用槽位**（第 5 回合的 `6-7-1` 与第 1 回合的 `1-2-3` 共用槽位 1）。
如果渲染时去读牌序，后面回合的改动会「倒灌」到前面回合的显示上。

**2. 要把某回合排布写回牌序，必须用 `deckAt(k)` 重放重建**

```js
// ✅ 从初始顺序重放 turns[0..k-1]，得到「第 k 回合开始前」的牌序
var base = deckAt(k);
// ❌ 直接读 turns[k] —— 它可能已经被更靠后的回合改动搞过期了
```

用过期快照回写会**丢 1 个人 + 造 1 个重复角色**（2.1.0 修的就是这个）。

**3. 新增引擎函数要放在指定区间内**

`tests/check.js` 按 `function startSlot` … `渲染：预设库` 切片提取引擎代码，
新增的引擎函数必须落在这个区间，否则测试取不到。

**4. 读取队伍成员一律用解析层**

```js
resolve(key)      // key → 统一卡对象
nameOf(key)       // key → 名字
typeOf(typeKey)   // 属性 key → 属性对象
dispName(card)    // 按语言偏好取显示名
```

❌ **不要用 `byId(id)`** —— 它只按 `presets[i].id` 裸匹配，解析不了图鉴卡
（统一 key 是 `r:<图鉴id>` / `p:<自建id>`），会让名字退化成「（已移除）」。
`byId()` 只适用于自建卡的编辑 / 删除路径。

**5. 改序必然连锁，别去「修」历史回合**

交换本回合三人的位置 = 交换他们的槽位归属，后面所有回合都会重算 —— 这是**刻意设计**。
前面回合的显示保持不动，也是刻意设计。

**6. 往 `state.team` 里写角色时，一律写统一 key**

```js
// ✅
state.team[0] = 'p:' + preset.id;   // 自建卡
state.team[0] = 'r:' + row[0];      // 图鉴卡
// ❌
state.team[0] = preset.id;          // 裸 id
```

裸 id 虽然靠兼容层还能渲染出来，但会让**同一套队伍算出两种指纹**，
导致编队去重与「当前编队」高亮失效（2.2.0 修的正是这个）。
读档时 `normalizeTeamKeys()` 会把历史裸 id 补齐，但新代码不要再产生裸 id。
队长 / 好友标记同理：`normRoleKey()` 负责补前缀，`normalizeRoles()` 负责与队伍对齐。

**7. 队长 / 好友必须始终是队伍成员，且互不相同**

真正的落点只有一处 —— `save()` 开头的 `syncRoles()`。它保证：

- 标记 ⊆ `state.team`（角色被移出队伍 → 标记自动摘掉）
- `leader !== friend`（同一人兼任时保留队长、清掉好友）

所以**任何改动队伍的路径都必须走到 `save()`**（`rebuild()` 已经内置调用）。
不要绕开 `save()` 直接写 `localStorage`，否则会落一份不一致的存档。
判断「某套编队是不是当前这套」也要用 `teamFullSignature()` ——
它把成员顺序 + 队长 + 好友一起算进去，所以同 7 人但队长不同的两套编队不会被当成同一套。

### 提交前

- [ ] `npm test` 三套全绿
- [ ] 改了引擎 / 交互 → 补了对应回归用例
- [ ] 改了 `tools/i18n-zh.json` → 跑了 `npm run build` 并提交新 `roster.js`
- [ ] 严格遵守[关键不变量](#改代码前请先了解这几条不变量)

### 代码风格

- 应用本体：**原生 JS（ES5 语法写主体，兼容性好）+ 零依赖**，CSS/JS 内联在 `index.html`
- 工具与测试：ESM（`.mjs`）+ Node 内置模块，`tests/check.js` 是 CJS（保持 `require`）
- 缩进 2 空格、LF 换行（见 `.editorconfig`）
- UI 文案一律中文；注释写清「为什么」，而不是「做了什么」

### 提交信息

参考 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 支持保存多套队伍方案
fix: 跨回合改序导致角色重复
data: 补 12 条角色名术语
docs: 说明反推的槽位约束
test: 补充连续放置的回归用例
```

---

## 数据相关贡献

数据来自 [DOKKAN.FYI](https://dokkan.fyi)（非官方粉丝资料站）。重新抓取时请：

- **串行请求**，不要并发压测对方站点（`tools/crawl.mjs` 已内置 120ms 间隔与本地缓存）
- 抓取前确认来源站点的 `robots.txt` / `llms.txt` 与服务条款
- 不要把抓取缓存 `data/cache/` 提交进仓库（已 gitignore）

权利归属与商标声明见 [NOTICE.md](../NOTICE.md)。**请勿提交任何图片文件**——
界面用的是第三方 CDN 外链，本仓库不存储图像资源。
