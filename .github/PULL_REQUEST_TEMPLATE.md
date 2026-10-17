<!-- 感谢贡献！请先看 CONTRIBUTING.md -->

## 这个 PR 做了什么

<!-- 一句话说清目的；关联的 Issue 用 Fixes #123 形式 -->

## 改动类型

- [ ] 🐞 修 Bug
- [ ] ✨ 新功能
- [ ] ✏️ 译名 / 词典修正（`tools/i18n-zh.json`）
- [ ] 📖 文档
- [ ] 🎨 界面 / 样式
- [ ] ♻️ 重构（行为不变）
- [ ] 🧪 测试

## 涉及文件

<!-- 主要改了哪些文件 -->

## 测试

- [ ] `npm run test:engine` 通过（引擎回归 144 项）
- [ ] `npm run test:static` 通过（静态校验 77 项）
- [ ] `npm run test:dom` 通过（真实页面 128 项）
- [ ] 若改了引擎 / 交互，已补充或更新对应回归用例

<details>
<summary>测试输出（可粘贴）</summary>

```
<!-- 粘贴 npm test 的结果 -->
```

</details>

## 自查（改引擎时必看）

- [ ] 回合渲染读的是 **快照** `state.turns[t]`，不是 `state.deck`
- [ ] 写回牌序走的是 `deckAt(k)` 重放重建，没有直接读 `state.turns[k]`
- [ ] 新增的引擎函数放在 `function startSlot` 与 `渲染：预设库` **之间**
- [ ] 读取队伍成员用的是 `resolve()` / `nameOf()` / `typeOf()` / `dispName()`，没有用 `byId()`
- [ ] 若改了 `tools/i18n-zh.json`，已运行 `npm run build` 并提交新的 `roster.js`

## 界面改动截图（如有）

<!-- 拖入图片即可 -->
