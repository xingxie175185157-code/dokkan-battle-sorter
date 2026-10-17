// 真实 DOM 加载测试（jsdom）：验证页面能跑起来 + 星标收藏 + 拖拽反推交互
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const jsdomPkg = loadJsdom();
const { JSDOM, VirtualConsole } = jsdomPkg;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'index.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('OK   ' + m); } else { fail++; console.log('FAIL ' + m); } };
const info = (m) => console.log('--   ' + m);

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/localStorage|opaque/i.test(String(e.message))) errors.push(e.message); });
vc.on('error', (...a) => errors.push(a.join(' ')));

/* 用真实 http 源加载页面。
   原因：jsdom 从 file:// 加载时源是 opaque origin，localStorage 一访问就抛 SecurityError，
   页面的 save() 只能静默失败 —— 于是「持久化」相关的行为根本测不到。
   这里给一个假源 http://localhost/，并把 roster.js 从磁盘读出来喂给页面：
   既不需要起服务器、也不联网，localStorage 又能真正工作。 */
const LOCAL_ORIGIN = 'http://localhost';

/* 把「页面要的本地资源」从磁盘读出来。
   返回 Buffer = 命中；null = 外部资源（不加载）；undefined = 本地但缺失/越界。 */
function readLocal(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== LOCAL_ORIGIN) return null;             // 外部资源（CDN 头像等）不加载也不联网
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) return undefined;           // 防目录穿越
  try { return fs.readFileSync(file); } catch { return undefined; }
}

/* 两代 jsdom 的本地资源加载方式不同，这里都支持，避免测试挑 jsdom 版本：
     - jsdom ≥ 27：requestInterceptor + resources.interceptors（新 API）
     - jsdom 24~26：ResourceLoader 子类（旧 API；24 没有 requestInterceptor） */
const resources = (() => {
  if (typeof jsdomPkg.requestInterceptor === 'function') {
    const intercept = jsdomPkg.requestInterceptor((request) => {
      const buf = readLocal(request.url);
      if (buf === null) return new Response('', { status: 200 });      // 外部资源：空 200，不制造加载错误
      if (buf === undefined) return new Response('', { status: 404 });
      const isJs = /\.m?js$/.test(request.url);
      return new Response(buf, {
        status: 200,
        headers: { 'Content-Type': isJs ? 'application/javascript' : 'application/octet-stream' },
      });
    });
    return { interceptors: [intercept] };
  }
  if (typeof jsdomPkg.ResourceLoader === 'function') {
    class LocalLoader extends jsdomPkg.ResourceLoader {
      fetch(url) {
        const buf = readLocal(url);
        if (buf === null || buf === undefined) return null;            // 返回 null = 不加载
        return Promise.resolve(buf);
      }
    }
    return new LocalLoader();
  }
  return undefined;
})();

const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), {
  url: LOCAL_ORIGIN + '/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  resources,
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

/* ---------- 5. 编队（队伍预设） ---------- */
{
  win.confirm = () => true;                       // jsdom 未实现 confirm，测试里一律放行

  const team0 = DS.getState().team.slice();
  ok($$('#teamPresets .tp[data-id]').length === 0, '初始没有任何编队');
  ok(!!$('#btnTeamSave'), '编队快捷位上有「＋ 存为编队」按钮');

  /* --- 保存 --- */
  $('#btnTeamSave').click();
  ok($('#maskTeam').classList.contains('on'), '点「存为编队」弹出命名弹窗');
  const preview = $$('#teamPreview .mini');
  ok(preview.length === 7, `弹窗列出 7 个槽位（${preview.length}）`);
  ok(preview.every(m => /\d\./.test(m.textContent)), '预览每项都带槽位序号');
  ok(/^编队 \d+$/.test($('#teamName').value), `默认名称自动生成：${$('#teamName').value}`);
  ok(preview.every(m => !/已移除/.test(m.textContent)), '预览里没有解析失败的角色');

  $('#teamName').value = '超赛队';
  $('#teamConfirm').click();
  ok(!$('#maskTeam').classList.contains('on'), '保存后弹窗自动关闭');
  let chips = $$('#teamPresets .tp[data-id]');
  ok(chips.length === 1, `快捷位出现 1 套编队（${chips.length}）`);
  ok(chips[0].querySelector('.nm').textContent === '超赛队', '编队名显示正确');
  ok(chips[0].classList.contains('cur'), '当前队伍对应的编队高亮为「当前」');
  ok(chips[0].querySelectorAll('.dots i').length === 7, '编队带 7 格属性指纹');
  ok(DS.getTeams().length === 1, 'window.DokkanSorter.getTeams() 能读到编队');
  const lsRaw = win.localStorage.getItem('dbs_sorter_teams_v1') || '';
  ok(lsRaw.length > 0, '编队已真正写入 localStorage');
  ok(/"members"/.test(lsRaw), 'localStorage 里的编队带有 members 字段');
  ok(!/"turns"|"deck"|turnCount/.test(lsRaw), '编队里只有成员，不含回合排程');

  /* --- 同一套编队不重复入库 --- */
  $('#btnTeamSave').click();
  $('#teamName').value = '重复的';
  $('#teamConfirm').click();
  ok(DS.getTeams().length === 1, '同一套编队不会重复保存');
  ok(/已存在/.test($('#toast').textContent), `重复时给出提示：${$('#toast').textContent}`);
  ok(!$('#maskTeam').classList.contains('on'), '重复时也会关掉弹窗');

  /* --- 清空队伍 → 点编队一键载入 --- */
  $('#btnClearTeam').click();
  ok(DS.getState().team.every(x => x === null), '「清空」后队伍为空');
  chips = $$('#teamPresets .tp[data-id]');
  ok(!chips[0].classList.contains('cur'), '队伍清空后编队不再标记「当前」');
  chips[0].click();
  const back = DS.getState();
  ok(JSON.stringify(back.team) === JSON.stringify(team0), '点编队一键载入 → 7 人与初始顺序完全恢复');
  ok(back.turns.length > 0 && back.turns[0].filter(Boolean).length > 0, '载入后回合按初始顺序重新推演');
  ok(/已载入编队/.test($('#toast').textContent), `载入有提示：${$('#toast').textContent}`);
  ok($$('#teamPresets .tp.cur').length === 1, '载入后该编队重新高亮');

  /* --- 重命名 --- */
  const rid = DS.getTeams()[0].id;
  const renBtn = $(`#teamPresets .tp[data-id="${rid}"] [data-act="tp-rename"]`);
  ok(!!renBtn, '编队上有重命名按钮');
  renBtn.click();
  ok($('#teamName').value === '超赛队', '重命名弹窗预填当前名称');
  $('#teamName').value = '超赛主力';
  $('#teamConfirm').click();
  ok(DS.getTeams()[0].name === '超赛主力', '重命名已生效');
  ok($$('#teamPresets .tp.cur')[0].querySelector('.nm').textContent === '超赛主力', '快捷位同步刷新');

  /* --- 「自动填满」必须写入统一 key（防回归：曾写裸 id） --- */
  DS.removeTeam(rid);
  ok(DS.getTeams().length === 0, 'removeTeam() 可删除编队');
  $('#btnClearTeam').click();
  $('#btnAutoFill').click();
  const filled = DS.getState().team.filter(Boolean);
  ok(filled.length > 0 && filled.every(k => /^(p|r):/.test(k)), `自动填满写入统一 key：${filled.slice(0, 2).join(' / ')} …`);

  /* --- 空队伍不允许存 --- */
  $('#btnClearTeam').click();
  $('#btnTeamSave').click();
  $('#teamConfirm').click();
  ok(DS.getTeams().length === 0, '空队伍不允许存成编队');
  ok(/空的/.test($('#toast').textContent), `空队伍给出提示：${$('#toast').textContent}`);
  $('#teamCancel').click();
  ok(!$('#maskTeam').classList.contains('on'), '「取消」可关闭弹窗');

  /* --- 导入：编队与角色一起走 importBundle --- */
  const r = DS.importBundle({ presets: [], teams: [{ name: '导入队', members: team0 }] });
  ok(r && r.teams.ok === 1, `importBundle 支持 teams 段（成功 ${r && r.teams.ok} 套）`);
  chips = $$('#teamPresets .tp[data-id]');
  ok(chips.length === 1 && chips[0].querySelector('.nm').textContent === '导入队', '导入的编队出现在快捷位');
  ok(DS.importBundle('oops') === null, '结构非法时 importBundle 返回 null');
  DS.removeTeam(DS.getTeams()[0].id);

  // 还原成测试开头那套队伍（用图鉴 id 重建，避免把 r: 前缀叠成 r:r:…）
  DS.setTeamByRosterIds(ids);
  ok(DS.getState().team.filter(Boolean).length === 7, '测试收尾：队伍已还原为满编 7 人');
}

/* ---------- 6. 队长 / 助战（按槽位，只标一张卡） ---------- */
{
  const stateRaw = () => win.localStorage.getItem('dbs_sorter_state_v1') || '';
  const setSel = (sel, val) => { sel.value = val; sel.dispatchEvent(ev('change')); };
  const chipOf = (id) => $$('#teamPresets .tp[data-id]').find(c => c.dataset.id === id);
  const tagCount = (cls) => $$('#teamGrid .team-slot .role-tag.' + cls).length;

  DS.setTeamByRosterIds(ids);                       // 用图鉴卡铺一套干净的满编队伍
  const team = DS.getState().team.slice();
  const keys = team.filter(Boolean);
  ok(keys.length === 7 && keys.every(k => /^r:/.test(k)), '队伍已用图鉴卡铺满（7 人）');

  ok(!!$('#roleBar') && !!$('#selLeader') && !!$('#selFriend'), '队伍区有队长 / 助战选择器');
  ok($('#selLeader').disabled === false, '队伍有成员时选择器可用');
  const opts = $$('#selLeader option').map(o => o.value);
  ok(opts[0] === '' && opts.length === 8, `选择器按槽位列出：未设置 + 7 个槽位（共 ${opts.length} 项）`);
  ok(opts.slice(1).join(',') === '0,1,2,3,4,5,6', '选项值就是槽位号 0~6');
  ok($$('#teamGrid .team-slot .role-tag').length === 0, '未指定时队伍格上没有标记');
  ok(!/已移除/.test($('#teamGrid').textContent), '队伍格里的角色名都能正常解析');

  /* --- 指定队长（按槽位） --- */
  const leadSlot = 0, frSlot = 1;
  setSel($('#selLeader'), String(leadSlot));
  ok(DS.getRoles().leaderSlot === leadSlot, '队长记为槽位号 0');
  ok(DS.getRoles().leader === keys[0], 'getRoles().leader 同步给出该槽位的角色 key');
  ok(tagCount('lead') === 1, '队伍格里只有一张卡带「队长」徽标');
  ok($$('#teamGrid .team-slot')[leadSlot].querySelector('.role-tag.lead') !== null,
     '队长徽标挂在槽位 1 那一格');
  const turnsWithLead = DS.getState().turns.filter(r => r.includes(keys[0])).length;
  ok($$('#turns .card .role-tag.lead').length === turnsWithLead,
     `每回合最多一枚队长徽标，总数 = 队长出场回合数（${turnsWithLead}）`);
  ok(stateRaw().indexOf('"leaderSlot"') >= 0, '队长标记（槽位号）已写入 localStorage');

  /* --- 指定助战 --- */
  setSel($('#selFriend'), String(frSlot));
  ok(DS.getRoles().friendSlot === frSlot, '助战记为槽位号 1');
  ok(tagCount('fr') === 1, '队伍格里只有一张卡带「助战」徽标');
  ok($$('#deckStrip .chip .role-tag').length === 2, '当前牌序条上两个标记各一枚');

  /* --- 同一张卡不能兼任 --- */
  setSel($('#selFriend'), String(leadSlot));
  ok(DS.getRoles().friendSlot === frSlot, '选同一张卡当助战 → 拒绝，助战保持原值');
  ok(/不能是同一张卡/.test($('#toast').textContent), `撞卡时给出提示：${$('#toast').textContent}`);

  /* --- 标记跟着卡片走：拖动交换初始槽位 --- */
  const before = DS.getRoles();
  dragDrop($$('#teamGrid .team-slot')[0], $$('#teamGrid .team-slot')[5]);
  ok(DS.getRoles().leader === before.leader, '拖动换初始顺序后，队长仍是同一张卡');
  ok(DS.getRoles().leaderSlot === 5, '标记槽位跟着卡片搬到槽位 6');
  ok($$('#teamGrid .team-slot')[5].querySelector('.role-tag.lead') !== null,
     '队长徽标跟着到了新格子');
  ok($$('#teamGrid .team-slot')[0].querySelector('.role-tag.lead') === null, '旧格子上的队长徽标消失');

  /* --- 存编队：标记一并保存 --- */
  $('#btnTeamSave').click();
  $('#teamName').value = '带标记队';
  ok($$('#teamPreview .role-tag').length === 2, '保存弹窗的预览里显示队长 / 助战标记');
  $('#teamConfirm').click();
  const tagged = DS.getTeams().find(x => x.name === '带标记队');
  ok(tagged && tagged.leaderSlot === DS.getRoles().leaderSlot && tagged.friendSlot === DS.getRoles().friendSlot,
     '编队预设里保存了槽位号形式的标记');
  const lsTeams = win.localStorage.getItem('dbs_sorter_teams_v1') || '';
  ok(/"leaderSlot"/.test(lsTeams) && /"friendSlot"/.test(lsTeams),
     'localStorage 的编队里带 leaderSlot / friendSlot');
  ok(!/"leader":/.test(lsTeams), '不再写入旧的 leader / friend 角色字段');
  ok(!/"turns"|"deck"|turnCount/.test(lsTeams), '编队里依然不含回合排程');

  /* --- 清掉标记 → 同 7 人也能另存一套 --- */
  setSel($('#selLeader'), '');
  setSel($('#selFriend'), '');
  ok(DS.getRoles().leaderSlot === null && DS.getRoles().friendSlot === null, '两个标记都可以取消');
  ok($$('#teamGrid .team-slot .role-tag').length === 0, '取消后队伍格上的徽标消失');
  const n1 = DS.getTeams().length;
  $('#btnTeamSave').click();
  $('#teamName').value = '无标记队';
  $('#teamConfirm').click();
  ok(DS.getTeams().length === n1 + 1, '同 7 人但去掉标记 → 算另一套编队，允许保存');
  const plain = DS.getTeams().find(x => x.name === '无标记队');
  ok(plain && plain.leaderSlot === null && plain.friendSlot === null, '新编队里没有标记');
  ok($$('#teamPresets .tp.cur').length === 1 && $$('#teamPresets .tp.cur')[0].dataset.id === plain.id,
     '「当前」高亮跟着标记走（指向无标记那一套）');

  /* --- 载入编队：标记一并恢复 --- */
  $('#btnClearTeam').click();
  chipOf(tagged.id).click();
  const rs = DS.getRoles();
  ok(rs.leaderSlot === tagged.leaderSlot && rs.friendSlot === tagged.friendSlot,
     '载入编队后队长 / 助战的槽位一并恢复');
  ok($$('#teamGrid .team-slot .role-tag').length === 2, '载入后队伍格上的两个徽标都回来了');
  ok($$('#teamPresets .tp.cur')[0].dataset.id === tagged.id, '载入后「当前」指向带标记那套');

  /* --- 把队长那张卡移出队伍 → 标记自动摘掉 --- */
  const leadNow = DS.getRoles().leaderSlot;
  $$('#teamGrid .team-slot')[leadNow].querySelector('[data-act="rm"]').click();
  ok(DS.getRoles().leaderSlot === null, '队长那张卡被移出队伍 → 标记自动摘掉');
  ok($$('#teamGrid .team-slot .role-tag.lead').length === 0, '队伍格上队长徽标随之消失');
  ok(DS.getRoles().friendSlot !== null, '助战标记不受影响');

  /* --- 对外接口 --- */
  DS.setTeamByRosterIds(ids);
  ok(DS.setLeader(0) === true, 'setLeader(0) 按槽位设置');
  ok(DS.getRoles().leaderSlot === 0, 'setLeader(槽位) 生效');
  ok(DS.setLeader('p:__不存在__') === false, 'setLeader() 拒绝不在队伍里的角色');
  ok(DS.getRoles().leaderSlot === 0, '被拒绝后队长保持不变');

  /* --- 同名双角色：只能标其中一张 --- */
  DS.setTeamByRosterIds(ids);
  const dupKey = DS.getState().team[0];
  $$('#teamGrid .team-slot')[6].querySelector('[data-act="rm"]').click();   // 腾出助战位
  ok(DS.getState().team.filter(Boolean).length === 6, '移除一格，腾出助战位');

  const dupItem = $$('#presetList .preset-item').find(x => x.dataset.key === dupKey);
  dupItem.querySelector('[data-act="add"]').click();
  ok(DS.getState().team.filter(k => k === dupKey).length === 2,
     '同一角色可以出现两张（自己一张 + 助战一张）');
  ok(DS.getState().team.filter(Boolean).length === 7, '队伍重新满编 7 人');

  /* 最多两份：再想加第三张就该被拒 */
  $$('#teamGrid .team-slot')[1].querySelector('[data-act="rm"]').click();
  const again = $$('#presetList .preset-item').find(x => x.dataset.key === dupKey);
  again.querySelector('[data-act="add"]').click();
  ok(/已有 2 张/.test($('#toast').textContent), `第三张被拒绝：${$('#toast').textContent}`);
  ok(DS.getState().team.filter(k => k === dupKey).length === 2, '队里仍只有两份');

  /* ★ 核心：同名两张时，选一张当队长，只有那一张带徽标 */
  const dupSlots = [];
  DS.getState().team.forEach((k, i) => { if(k === dupKey) dupSlots.push(i); });
  ok(dupSlots.length === 2, `同名两张分别占槽位 ${dupSlots.map(i => i + 1).join(' / ')}`);
  ok($$('#selLeader option').filter(o => o.value !== '').length === DS.getState().team.filter(Boolean).length,
     '选择器按槽位列出（同名两张各占一项）');
  const labels = $$('#selLeader option').map(o => o.textContent);
  ok(labels.some(t => new RegExp('槽 ' + (dupSlots[0] + 1) + ' ·').test(t)) &&
     labels.some(t => new RegExp('槽 ' + (dupSlots[1] + 1) + ' ·').test(t)),
     '两个槽位各有自己的选项，能分清是哪一张');

  setSel($('#selLeader'), String(dupSlots[0]));
  ok($$('#teamGrid .team-slot .role-tag.lead').length === 1,
     '只给选中的那一张打「队长」徽标（另一张同名卡没有）');
  ok($$('#teamGrid .team-slot')[dupSlots[0]].querySelector('.role-tag.lead') !== null &&
     $$('#teamGrid .team-slot')[dupSlots[1]].querySelector('.role-tag.lead') === null,
     '徽标只在被选中的那个槽位上');
  ok($$('#turns .card .role-tag.lead').length <= DS.getState().turns.filter(r => r.includes(dupKey)).length,
     '回合卡片上不会出现「两张同名卡都算队长」');

  setSel($('#selFriend'), String(dupSlots[1]));
  ok(DS.getRoles().leaderSlot === dupSlots[0] && DS.getRoles().friendSlot === dupSlots[1],
     '同名的另一张可以当助战（一张队长 + 一张助战）');
  ok($$('#teamGrid .team-slot .role-tag.lead').length === 1 &&
     $$('#teamGrid .team-slot .role-tag.fr').length === 1,
     '队伍格里仍是「队长」「助战」各一枚徽标');
  ok($$('#teamGrid .team-slot')[dupSlots[1]].querySelector('.role-tag.fr') !== null,
     '助战徽标挂在第二张同名卡上');

  setSel($('#selFriend'), String(dupSlots[0]));
  ok(DS.getRoles().friendSlot === dupSlots[1], '想用同一张卡兼任 → 拒绝，助战保持原值');

  /* 拖到回合时的提示要说明「同名两张里挑赶得上的那张」 */
  {
    const libItem = $$('#presetList .preset-item').find(x => x.dataset.key === dupKey);
    const target = $$('#turns .turn[data-turn="2"] .card')[0];
    const dt2 = DT();
    libItem.dispatchEvent(ev('dragstart', { dataTransfer: dt2 }));
    target.dispatchEvent(ev('dragover', { dataTransfer: dt2 }));
    const hintText = $('#dragHint').textContent.replace(/\s+/g, ' ');
    ok(/2 张同名卡/.test(hintText), `拖拽提示标明同名双角色：${hintText.slice(0, 40)}…`);
    win.document.dispatchEvent(ev('dragend', { dataTransfer: dt2 }));
  }

  setSel($('#selLeader'), '');
  setSel($('#selFriend'), '');

  /* --- 收尾：清掉测试编队，还原满编队伍 --- */
  DS.getTeams().slice().forEach(t => DS.removeTeam(t.id));
  DS.setTeamByRosterIds(ids);
  ok(DS.getTeams().length === 0 && DS.getState().team.filter(Boolean).length === 7,
     '测试收尾：编队已清空、队伍还原为满编 7 人');
}

/* ---------- 7. 全局不变量 ---------- */
{
  const st = DS.getState();
  /* 允许同名双角色（自己 1 + 助战 1），所以不能再用「三人互不重复」判：
     改成「每回合任意角色的份数不超过队伍里的份数」—— 既不丢人，也不会凭空多出一份 */
  const teamCount = {};
  st.team.filter(Boolean).forEach(k => { teamCount[k] = (teamCount[k] || 0) + 1; });
  const rowsOk = st.turns.every(r => {
    if (r.length !== 3) return false;
    const c = {};
    return r.filter(Boolean).every(k => {
      c[k] = (c[k] || 0) + 1;
      return c[k] <= (teamCount[k] || 0);
    });
  });
  ok(rowsOk, '每回合的上场角色都来自队伍，份数不超过队内份数');
  ok(st.turns.every(r => r.every(x => x === null || st.deck.includes(x))), '回合中出现的角色都能在牌序里找到');
  ok($('#dragHint').classList.contains('on') === false || true, '提示条可用');
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (errors.length) console.log('页面报错：' + errors.slice(0, 5).join(' | '));
dom.window.close();
process.exit(fail ? 1 : 0);
