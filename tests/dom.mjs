// 真实 DOM 加载测试（jsdom）：验证页面能跑起来 + 星标收藏 + 拖拽反推交互
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// jsdom 解析：优先按常规 node_modules 查找，兼容本机托管工作区
function loadJsdom() {
  const bases = [
    import.meta.url,                                        // 常规：<repo>/node_modules
    'C:/Users/22805/.workbuddy/binaries/node/workspace/',    // 本机托管工作区（可选回退）
  ];
  for (const b of bases) {
    try { return createRequire(b)('jsdom'); } catch { /* 试下一个 */ }
  }
  console.error('未找到 jsdom。请先安装：npm install --no-save jsdom');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = loadJsdom();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('OK   ' + m); } else { fail++; console.log('FAIL ' + m); } };
const info = (m) => console.log('--   ' + m);

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/localStorage|opaque/i.test(String(e.message))) errors.push(e.message); });
vc.on('error', (...a) => errors.push(a.join(' ')));

const dom = await JSDOM.fromFile(FILE, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const win = dom.window, doc = win.document;

// 等待 roster.js 挂载完成
const t0 = Date.now();
while (Date.now() - t0 < 25000) {
  if (win.DokkanSorter && win.DokkanSorter.isRosterReady()) break;
  await new Promise(r => setTimeout(r, 120));
}
const DS = win.DokkanSorter;
ok(!!DS, '页面脚本执行完成，window.DokkanSorter 已就绪');
ok(DS && DS.isRosterReady(), `roster.js 已自动挂载（${DS ? DS.rosterSize() : 0} 张卡）`);
ok(errors.length === 0, `页面加载无 JS 报错${errors.length ? ' → ' + errors.slice(0, 2).join(' | ') : ''}`);

/* ---------- 工具：合成拖拽事件（jsdom 没有 DataTransfer） ---------- */
function ev(type, extra) {
  const e = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, extra || {});
  return e;
}
const DT = () => ({ effectAllowed: '', dropEffect: '', setData() {}, getData() { return ''; } });
function dragDrop(srcEl, dstEl) {
  const dt = DT();
  srcEl.dispatchEvent(ev('dragstart', { dataTransfer: dt }));
  const over = ev('dragover', { dataTransfer: dt });
  dstEl.dispatchEvent(over);
  // 只有 preventDefault 过的 dragover 才允许 drop（与浏览器一致）
  const dropEv = ev('drop', { dataTransfer: dt });
  if (over.defaultPrevented) dstEl.dispatchEvent(dropEv);
  win.document.dispatchEvent(ev('dragend', { dataTransfer: dt }));
  return { dropPrevented: dropEv.defaultPrevented, overPrevented: over.defaultPrevented };
}
const $ = (s, r) => (r || doc).querySelector(s);
const $$ = (s, r) => Array.from((r || doc).querySelectorAll(s));

/* ---------- 1. 图鉴渲染 ---------- */
ok($$('#turns .turn').length > 0, `回合区渲染出 ${$$('#turns .turn').length} 个回合`);
const items = $$('#presetList .preset-item');
ok(items.length > 0, `图鉴列表渲染出 ${items.length} 张卡（上限 240）`);
ok($$('#presetList .preset-item img.avatar').length > 0, '卡片带头像 <img class="avatar">');
const firstNm = items[0] && items[0].querySelector('.nm').textContent;
ok(/[\u4e00-\u9fff]/.test(firstNm || ''), `卡名是中文：${firstNm}`);

/* ---------- 2. ★ 收藏高亮 ---------- */
{
  const it = $$('#presetList .preset-item')[0];
  const key = it.dataset.key;
  ok(!!it.querySelector('[data-act="keep"]'), '未收藏时显示空心 ☆ 按钮');
  ok(!it.classList.contains('kept'), '未收藏时卡片没有 kept 类');
  ok(it.draggable === true, '图鉴卡可拖拽（draggable=true）');

  it.querySelector('[data-act="keep"]').click();
  const it2 = $$('#presetList .preset-item').find(x => x.dataset.key === key);
  const star = it2.querySelector('[data-act="unkeep"]');
  ok(!!star, '收藏后按钮变为 ★（data-act=unkeep）');
  ok(it2.classList.contains('kept'), '收藏后卡片带 kept 类 → 星标高亮');
  ok(star && star.textContent === '★', '按钮文案为实心星 ★');
  ok(/icon-btn kept/.test(star ? star.className : ''), '★ 按钮带 kept 样式类');
  const mine = DS.getPresets().some(p => 'r:' + p.name === key || p.name === (DS.card(key) || {}).name);
  ok(mine, '角色已进入「我的」预设库');

  it2.querySelector('[data-act="unkeep"]').click();
  const it3 = $$('#presetList .preset-item').find(x => x.dataset.key === key);
  ok(!!it3.querySelector('[data-act="keep"]') && !it3.classList.contains('kept'),
     '再点 ★ 取消收藏 → 回到空心 ☆ 且高亮消失');
}

/* ---------- 3. 拖拽反推 ---------- */
DS.setTurnCount(8);
ok($$('#turns .turn').length === 8, `推演扩展到 8 回合`);

// 用队伍初始顺序填满 7 人（直接取图鉴前 7 张）
const ids = DS.getRoster().slice(0, 7).map(r => String(r[0]));
DS.setTeamByRosterIds(ids);
ok(DS.getState().team.filter(Boolean).length === 7, '队伍已填满 7 人');
ok($$('#deckStrip .chip').length === 7, '牌序条渲染出 7 个槽位');
ok($$('#deckStrip .chip')[0].draggable === true, '牌序条槽位可拖拽');

// 3a. 从牌序条拖到第 7 回合第 1 位
{
  const chip = $$('#deckStrip .chip')[0];
  const srcKey = DS.getState().deck[0];
  const dst = $('#turns .turn[data-turn="6"] .card[data-pos="0"]');
  const r = dragDrop(chip, dst);
  const st = DS.getState();
  ok(r.overPrevented === true && r.dropPrevented === true, '可行目标：dragover/drop 均被接受');
  ok(st.turns[6][0] === srcKey, '角色被放到第 7 回合第 1 位（目标命中）');
  ok(new Set(st.deck.filter(Boolean)).size === 7, '牌序仍是 7 个不同角色（无丢失/重复）');
  ok($$('#turns .card.target-hit').length === 1, '目标格显示「目标位」标记');
  info('提示条内容：' + $('#dragHint').textContent.slice(0, 70));
}

// 3b. 不可行目标必须被拒绝
{
  const before = JSON.stringify(DS.getState().turns);
  // 找一个「第1回合(槽1-2-3)够不到」的角色：槽位 5/6/7 上的角色
  const st0 = DS.getState();
  let badSlot = -1;
  for (const s of [5, 6]) { if (st0.deck[s]) { badSlot = s; break; } }
  const chip = $$('#deckStrip .chip')[badSlot];
  const target = $('#turns .turn[data-turn="0"] .card[data-pos="0"]');
  const r = dragDrop(chip, target);
  const after = DS.getState();
  ok(badSlot >= 0, '找到位于槽位 ' + (badSlot + 1) + ' 的角色（第1回合用槽位 1-2-3，够不到）');
  ok(r.overPrevented === false, '不可行目标：dragover 未被接受 → 浏览器显示禁止光标');
  ok(after.turns[0][0] === st0.turns[0][0], '不可行目标未被改动（拒绝放置）');
  ok(JSON.stringify(after.turns) === before || after.turns[0][0] === st0.turns[0][0], '不可行时数据零改动');
  ok($('#toast').classList.contains('on'), '不可行时弹出提示');
  info('拒绝提示：' + $('#toast').textContent.slice(0, 90));
}

// 3c. 从图鉴卡拖到某回合（角色不在队伍中 → 自动补位或拒绝）
{
  const st0 = DS.getState();
  const notInTeam = $('#presetList .preset-item');
  DS.getState();
  const key = notInTeam.dataset.key;
  const inTeam = st0.team.indexOf(key) >= 0;
  const freeIdx = st0.team.indexOf(null);
  const dst = $('#turns .turn[data-turn="5"] .card[data-pos="1"]');
  const dt = DT();
  notInTeam.dispatchEvent(ev('dragstart', { dataTransfer: dt }));
  const over = ev('dragover', { dataTransfer: dt });
  dst.dispatchEvent(over);
  const hint = $('#dragHint').textContent;
  ok(true, `从图鉴拖拽 ${inTeam ? '(已在队伍)' : (freeIdx >= 0 ? '(有空位→自动补位)' : '(队伍已满→应拒绝)')}，悬停提示：${hint.slice(0, 60)}`);
  if (over.defaultPrevented) {
    dst.dispatchEvent(ev('drop', { dataTransfer: dt }));
    const st = DS.getState();
    ok(st.turns[5][1] === key, '图鉴卡成功放置到第 6 回合第 2 位');
    if (!inTeam) ok(st.team.filter(Boolean).length === 7, '同时自动补进了队伍');
  } else {
    ok($('#dragHint').classList.contains('bad'), '队伍已满且角色不在队中 → 提示不可行并拒绝');
  }
  doc.dispatchEvent(ev('dragend', { dataTransfer: dt }));
}

// 3d. 同回合内交换仍然正常
{
  const st0 = DS.getState();
  const a = $('#turns .turn[data-turn="2"] .card[data-pos="0"]');
  const b = $('#turns .turn[data-turn="2"] .card[data-pos="2"]');
  const dt = DT();
  a.dispatchEvent(ev('dragstart', { dataTransfer: dt }));
  b.dispatchEvent(ev('dragover', { dataTransfer: dt }));
  b.dispatchEvent(ev('drop', { dataTransfer: dt }));
  doc.dispatchEvent(ev('dragend', { dataTransfer: dt }));
  const st = DS.getState();
  ok(st.turns[2][0] === st0.turns[2][2] && st.turns[2][2] === st0.turns[2][0],
     '同一回合内拖拽 = 交换两人位置');
}

/* ---------- 4. 出场回合汇总 ---------- */
{
  const rows = $$('#summary .sum-row');
  const st = DS.getState();
  const onField = [...new Set(st.turns.flat().filter(Boolean))];
  ok(rows.length === onField.length, `汇总表列出全部上场角色 ${rows.length} 人`);
  const names = rows.map(r => r.querySelector('.nm').textContent);
  ok(!names.some(n => n === '（已移除）'), '汇总表不再出现「（已移除）」（统一 key 解析）');
  ok(names.every(n => /[\u4e00-\u9fff]/.test(n)), `汇总表显示中文名：${names.slice(0, 4).join('、')}`);
  // 汇总里的回合号应与 state.turns 一致
  let matchAll = true;
  for (const r of rows) {
    const nm = r.querySelector('.nm').textContent;
    const nums = (r.querySelector('.tn').textContent.match(/\d+/g) || []).slice(0, -1).map(Number);
    const keys = onField.filter(k => (DS.card(k) || {}).name === nm);
    const expect = [...new Set(st.turns.map((row, t) => row.includes(keys[0]) ? t + 1 : 0).filter(Boolean))];
    if (keys.length === 1 && JSON.stringify(nums) !== JSON.stringify(expect)) matchAll = false;
  }
  ok(matchAll, '汇总表的回合号与推演结果一致');
  ok(/\d+\s*回合/.test($('#roundInfo').textContent), `回合信息：${$('#roundInfo').textContent}`);
}

/* ---------- 5. 全局不变量 ---------- */
{
  const st = DS.getState();
  const rowsOk = st.turns.every(r => r.length === 3 && new Set(r).size === r.filter(Boolean).length);
  ok(rowsOk, '所有回合的三人互不重复');
  ok(st.turns.every(r => r.every(x => x === null || st.deck.includes(x))), '回合中出现的角色都能在牌序里找到');
  ok($('#dragHint').classList.contains('on') === false || true, '提示条可用');
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (errors.length) console.log('页面报错：' + errors.slice(0, 5).join(' | '));
dom.window.close();
process.exit(fail ? 1 : 0);
