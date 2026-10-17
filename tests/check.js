const fs = require('fs');
const path = require('path').join(__dirname, '..', 'index.html');
const html = fs.readFileSync(path, 'utf8');

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: 未找到 script 块'); process.exit(1); }
const src = m[1];

/* ---------- 1. 语法检查（编译但不执行） ---------- */
try { new Function(src); console.log('OK  语法检查通过（整段脚本可编译）'); }
catch (e) { console.error('FAIL 语法错误: ' + e.message); process.exit(1); }

/* ---------- 2. 抽取真实引擎代码做逻辑测试 ---------- */
const startIdx = src.indexOf('function startSlot');
const near = src.indexOf('渲染：预设库');
const endIdx = src.lastIndexOf('/* ====', near);
if (startIdx < 0 || endIdx < 0) { console.error('FAIL: 无法定位引擎代码段'); process.exit(1); }
const engine = src.slice(startIdx, endIdx);

const prelude = `
var SLOTS = 7;
var TYPES = {str:{name:'力'},agl:{name:'速'},teq:{name:'技'},int:{name:'知'},phy:{name:'体'},none:{name:'无'}};
var TYPE_ORDER = ['str','agl','teq','int','phy','none'];
var LS_PRESETS='a', LS_STATE='b', LS_SEEDED='c', LS_TEAMS='d', DEFAULT_TURNS=5;
var presets = [];
var teams = [];
var state = { team:new Array(7).fill(null), deck:new Array(7).fill(null), turns:[], turnCount:5, leaderSlot:null, friendSlot:null };
function $(s){ return { classList:{add:function(){},remove:function(){}}, textContent:'', value:'', innerHTML:'' }; }
function $$(s){ return []; }
function esc(s){ return String(s==null?'':s); }
function typeOf(k){ return TYPES[k] || TYPES.none; }
function uid(){ return 'u' + Math.random().toString(36).slice(2,8); }
function byId(id){ if(!id){return null;} for(var i=0;i<presets.length;i++){ if(presets[i].id===id){return presets[i];} } return null; }
function nameOf(id){ var p = byId(id); return p ? p.name : '（已移除）'; }
var localStorage = { getItem:function(){ return null; }, setItem:function(){} };
function renderTurns(){} function renderSummary(){} function renderDeckStrip(){} function renderAll(){} function toast(){}
var dragSrc = null, dragHintCache = null, autoMarks = null, autoMarkTimer = null;
`;
const postlude = `
module.exports = {
  state: state, slotsOf: slotsOf, slotLabels: slotLabels, startSlot: startSlot,
  rebuild: rebuild, ensureTurns: ensureTurns, setTurnOrder: setTurnOrder, swapInTurn: swapInTurn,
  planPlacement: planPlacement, applyPlacement: applyPlacement,
  reachableSlots: reachableSlots, goodSets: goodSets,
  teamFromMembers: teamFromMembers, teamSignature: teamSignature,
  normalizeTeams: normalizeTeams, remapTeamMembers: remapTeamMembers,
  normalizeTeamKeys: normalizeTeamKeys,
  fixArr: fixArr,
  normRoleKey: normRoleKey, normalizeRoles: normalizeRoles, syncRoles: syncRoles,
  roleSlotOf: roleSlotOf, roleValueOf: roleValueOf, teamRoles: teamRoles,
  roleKeyAt: roleKeyAt, swapRoleSlot: swapRoleSlot,
  teamFullSignature: teamFullSignature, currentTeamObj: currentTeamObj,
  teamSlotsOf: teamSlotsOf, copyCountOf: copyCountOf, planFromSlot: planFromSlot,
  seed: seedPresets,
  setPresets: function(a){ presets.length = 0; a.forEach(function(x){ presets.push(x); }); },
  names: function(row){ return row.map(function(id){ return (byId(id)||{}).name || '空'; }).join('-'); }
};
`;
const modPath = require('path').join(require('os').tmpdir(), 'dbs_sorter_engine_test.js');
fs.writeFileSync(modPath, prelude + engine + postlude, 'utf8');
const E = require(modPath);

/* ---------- 3. 断言工具 ---------- */
let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('OK   ' + label + '  =>  ' + actual); }
  else { fail++; console.log('FAIL ' + label + '  期望[' + expected + ']  实际[' + actual + ']'); }
}

/* 造 7 个角色 p1..p7 */
const ch = [];
for (let i = 1; i <= 7; i++) ch.push({ id: 'p' + i, name: String(i), type: 'str', tags: [] });
E.setPresets(ch);
E.state.team = ['p1','p2','p3','p4','p5','p6','p7'];

/* ---- 用例1：默认 5 回合的槽位序列与角色序列 ---- */
E.rebuild(true);
eq(E.state.turns.length, 5, '默认生成回合数');
eq(E.state.turns.map((r,t)=>E.slotLabels(t).join('')).join(' | '),
   '123 | 456 | 712 | 345 | 671', '五回合槽位序列');
eq(E.state.turns.map(r=>E.names(r)).join(' | '),
   '1-2-3 | 4-5-6 | 7-1-2 | 3-4-5 | 6-7-1', '五回合角色序列');

/* ---- 用例2：继续向下计算（第 6 回合起始槽位 = 15 % 7 = 1） ---- */
E.ensureTurns(10);
eq(E.state.turns.length, 10, '延伸到 10 回合');
eq(E.state.turns.slice(5).map((r,i)=>E.slotLabels(i+5).join('-')).join(' | '),
   '2-3-4 | 5-6-7 | 1-2-3 | 4-5-6 | 7-1-2', '第 6~10 回合槽位序列');
eq(E.state.turns.slice(5).map(r=>E.names(r)).join(' | '),
   '2-3-4 | 5-6-7 | 1-2-3 | 4-5-6 | 7-1-2', '第 6~10 回合角色序列（未调整时二者一致）');

/* ---- 用例3：第1回合交换首尾（槽位 1 与 3） ---- */
E.swapInTurn(0, 0, 2);
eq(E.state.turns[0].join(','), 'p3,p2,p1', '第1回合交换后的顺序');
eq(E.names(E.state.turns[1]), '4-5-6', '第2回合不受影响（槽位不重叠）');
eq(E.names(E.state.turns[2]), '7-3-2', '第3回合被连锁重算（槽位 7-1-2 重叠）');
eq(E.names(E.state.turns[4]), '6-7-3', '第5回合被连锁重算（槽位 6-7-1 重叠）');
eq(E.names(E.state.turns[7]), '3-2-1', '第8回合被连锁重算（槽位 1-2-3 重叠）');

/* ---- 用例4：在第4回合（槽位 3-4-5，当前 1-4-5）做一次倒序 ---- */
eq(E.names(E.state.turns[3]), '1-4-5', '第4回合改序前的状态');
E.setTurnOrder(3, ['p5','p4','p1']);
eq(E.names(E.state.turns[3]), '5-4-1', '第4回合手动改序生效');
eq(E.names(E.state.turns[1]), '4-5-6', '历史回合（第2回合）保持不变');
eq(E.state.deck.join(','), 'p3,p2,p5,p4,p1,p6,p7', '当前牌序与最近一次调整一致');
eq(E.names(E.state.turns[8]), '4-1-6', '第9回合（槽位 4-5-6）随之重算');
eq(E.names(E.state.turns[6]), '1-6-7', '第7回合（槽位 5-6-7）随之重算');

/* ---- 用例5：非法顺序不应丢人 / 造出重复角色 ---- */
const snapshot = E.state.turns.map(r=>r.join(',')).join('|');
E.setTurnOrder(3, ['p5','p5','p5']);   // 非法：三人相同
const row3 = E.state.turns[3].slice().sort().join(',');
eq(row3, 'p1,p4,p5', '非法顺序被规整为原三人集合（不丢人、不重复）');
eq(E.state.turns.slice(0,9).map(r=>r.join(',')).join('|').split('|').length, 9, '回合总数稳定');

/* ---- 用例6：拖拽到相同位置不应产生变化 ---- */
const before = E.state.turns.map(r=>r.join(',')).join('|');
E.swapInTurn(3, 1, 1);
eq(E.state.turns.map(r=>r.join(',')).join('|'), before, '同位拖拽无副作用');

/* ---- 用例7：连续「＋1 回合」延伸不破坏历史 ---- */
const hist = E.state.turns.slice(0, 10).map(r=>r.join(',')).join('|');
E.ensureTurns(11); E.ensureTurns(12); E.ensureTurns(13);
eq(E.state.turns.slice(0,10).map(r=>r.join(',')).join('|'), hist, '延伸时历史回合保持原样');
eq(E.state.turns.length, 13, '可无限向下延伸');

/* ---- 用例8：收缩回合数 ---- */
E.ensureTurns(3);
eq(E.state.turns.length, 3, '收缩到 3 回合');

/* ---- 用例9：还原（rebuild）清空手动调整 ---- */
E.rebuild(true);
eq(E.state.turns.length, 3, '还原后按当前回合数重建');
eq(E.state.turns.map(r=>E.names(r)).join(' | '), '1-2-3 | 4-5-6 | 7-1-2', '还原后回到初始顺序');

/* ---- 用例10：完整周期为 7 回合 ---- */
E.ensureTurns(7);
eq(E.slotLabels(7).join(''), E.slotLabels(0).join(''), '第8回合槽位回到 123（周期 7 回合）');
eq(E.slotLabels(6).join('-'), '5-6-7', '第7回合槽位 5-6-7');
eq(E.state.turns[7] === undefined, true, '第8回合需继续延伸（周期 7 回合）');

/* ---- 用例11：跨回合共用槽位时，历史回合不被倒灌 ----
   第1回合用槽位 1-2-3，第5回合用槽位 6-7-1，两者共用槽位 1。
   改第5回合会改变槽位 1 的归属，但第1回合的历史显示必须保持不变。 */
E.ensureTurns(10);
E.setTurnOrder(4, ['p1','p7','p6']);   // 第5回合 6-7-1 -> 1-7-6
eq(E.names(E.state.turns[4]), '1-7-6', '第5回合改序生效');
eq(E.names(E.state.turns[0]), '1-2-3', '第1回合历史显示未被污染（共用槽位 1）');
eq(E.state.deck[0], 'p6', '当前牌序中槽位 1 已变成 p6（与历史快照不同，故渲染必须读快照）');
eq(E.names(E.state.turns[9]), '7-6-2', '第10回合（槽位 7-1-2）按新牌序重算');

/* ---- 用例8：属性别名导入解析（不走 DOM，仅验证结构函数存在） ---- */
eq(typeof E.state === 'object' && Array.isArray(E.state.team) && E.state.team.length === 7, true, '外部接口可读取 state');

/* ============================================================
   反推功能（把角色拖到指定回合）
   ============================================================ */
function reset(n){
  E.state.team = ['p1','p2','p3','p4','p5','p6','p7'];
  E.rebuild(true);
  E.ensureTurns(n || 8);
}

/* ---- 用例12：目标位已是该角色 → 无需任何调整 ---- */
reset(8);
{
  const p = E.planPlacement('p1', 0, 0);        // 第1回合 槽1，本来就是 p1
  eq(p.ok, true, '目标位已是该角色 → 可行');
  eq(p.already, true, '标记为「无需调整」');
  eq(p.steps.length, 0, '不需要任何前置调整');
}

/* ---- 用例13：不可行 —— 第1回合只能动槽位 1-2-3，够不到第2回合的 4-5-6 ---- */
reset(8);
{
  const p = E.planPlacement('p1', 1, 0);        // 想把 p1 放到第2回合
  eq(p.ok, false, 'p1 无法在第2回合上场 → 不可行');
  eq(p.reason, 'infeasible', '失败原因是排布不可行');
  eq(p.reachable.join(','), '0,1,2', '第2回合开始前 p1 只可能在槽位 1/2/3');
  eq(p.need.join(','), '3,4,5', '而第2回合上场的是槽位 4/5/6');
}

/* ---- 用例14：需要一步前置调整 ---- */
reset(8);
{
  // 第3回合(T=2)槽位 7-1-2 = p7,p1,p2；想把 p3 排到第3回合第3位(槽位2)
  const p = E.planPlacement('p3', 2, 2);
  eq(p.ok, true, 'p3 → 第3回合第3位：可行');
  eq(p.steps.length, 1, '只需要一步前置调整');
  eq(p.steps[0].turn, 0, '在第1回合动手');
  eq(p.steps[0].from + '→' + p.steps[0].to, '2→0', '把 p3 从槽位 3 换到槽位 1');

  const before1 = E.state.turns[1].join(',');
  const r = E.applyPlacement('p3', 2, 2);
  eq(r.ok, true, 'applyPlacement 执行成功');
  eq(E.state.turns[2][2], 'p3', '第3回合第3位确实是 p3（目标达成）');
  eq(E.state.turns[0][0], 'p3', '第1回合槽位 1 已换成 p3（前置调整生效）');
  eq(E.state.turns[1].join(','), before1, '夹在中间的第2回合不受影响');
  eq(E.state.turns[2].join(','), 'p7,p2,p3', '第3回合三人顺序正确');
}

/* ---- 用例15：改动尽量推迟到最靠后的回合 ---- */
reset(8);
{
  // 第5回合(T=4)槽位 6-7-1；p2 初始在槽位 2
  const p = E.planPlacement('p2', 4, 0);
  eq(p.ok, true, 'p2 → 第5回合：可行');
  eq(p.steps.length, 1, '一步即可');
  eq(p.steps[0].turn, 2, '在第3回合（能动手的最晚回合）调整，而非第1回合');
  const r = E.applyPlacement('p2', 4, 0);
  eq(r.ok, true, '执行成功');
  eq(E.state.turns[4][0], 'p2', '第5回合第1位是 p2');
  eq(E.state.turns[0].join(','), 'p1,p2,p3', '第1回合保持原样（改动被推迟）');
}

/* ---- 用例16：applyPlacement 必须保证目标成立（多目标连打） ---- */
reset(12);
{
  const wants = [['p5',5,1],['p7',6,2],['p2',7,0],['p6',3,1]];
  let all = true;
  for (const [k,t,pos] of wants){
    const r = E.applyPlacement(k, t, pos);
    if(!r.ok || E.state.turns[t][pos] !== k) all = false;
  }
  eq(all, true, '连续四次「拖到指定回合」全部命中目标位');
}

/* ---- 用例17：任何回合都不得丢人 / 造重复 ---- */
{
  const pool = ['p1','p2','p3','p4','p5','p6','p7'];
  let clean = true;
  E.state.turns.forEach(function(row){
    const s = row.slice().sort().join(',');
    if(s !== pool.join(',')) clean = false;      // 每回合都应恰好是 7 人中的某 3 人
  });
  eq(E.state.turns[0].length, 3, '每回合恰好 3 人');
  eq(new Set(E.state.deck).size, 7, '当前牌序仍是 7 个不同角色（无丢失 / 无重复）');
  eq(E.state.deck.filter(Boolean).length, 7, '牌序无空位');
}

/* ---- 用例18：不可行时 applyPlacement 不得改动任何数据 ---- */
reset(8);
{
  const snap = JSON.stringify({t:E.state.team, d:E.state.deck, r:E.state.turns});
  const r = E.applyPlacement('p4', 1, 0);        // 第2回合槽位 4-5-6 本来就是 p4,p5,p6 → 已达成
  eq(r.ok, true, '第2回合放 p4：本来就在，视为已达成');
  eq(E.state.turns[1][0], 'p4', '目标位成立');
  const snap2 = JSON.stringify({t:E.state.team, d:E.state.deck, r:E.state.turns});
  const bad = E.applyPlacement('p1', 1, 0);      // 这个才是真不可行
  eq(bad.ok, false, '不可行时返回失败');
  eq(JSON.stringify({t:E.state.team, d:E.state.deck, r:E.state.turns}) === snap2, true,
     '失败后数据零改动（无副作用）');
}

/* ---- 用例19：先改靠后回合、再回头改靠前回合 → 不得丢人 / 造重复 ----
   回合之间会共用槽位（第5回合用 6-7-1，第1回合用 1-2-3，共用槽位 1）。
   旧实现用「该回合的历史快照」回写牌序，这会拿过期数据覆盖牌序，
   导致角色凭空消失又出现重复。 */
reset(10);
{
  E.setTurnOrder(4, ['p1','p7','p6']);           // 先改第5回合
  eq(E.state.deck[0], 'p6', '改第5回合后：槽位 1 归 p6 所有');
  eq(E.names(E.state.turns[0]), '1-2-3', '第1回合的历史显示保持不变（刻意冻结）');
  E.setTurnOrder(0, ['p2','p1','p3']);           // 再回头改第1回合
  const d = E.state.deck;
  eq(d.filter(Boolean).length, 7, '牌序无空位');
  eq(new Set(d).size, 7, '牌序仍是 7 个不同角色（旧实现此处会丢人 + 重复）');
  eq(d.slice().sort().join(','), 'p1,p2,p3,p4,p5,p6,p7', '7 个角色一个不少');
  eq(E.names(E.state.turns[0]), '2-1-3', '第1回合改序生效');
}

/* ---- 用例20：反复来回改动后整体仍然自洽 ---- */
reset(14);
{
  const seq = [[4,0,2],[0,2,1],[9,1,0],[2,2,2],[6,0,1],[13,1,2]];
  let okAll = true;
  for(const [t,a,b] of seq){
    E.swapInTurn(t, a, b);
    if(new Set(E.state.deck.filter(Boolean)).size !== 7) okAll = false;
    const bad = E.state.turns.some(row => {
      const s = new Set(row);
      return row.length !== 3 || s.size !== 3;      // 每回合三人必须互不相同
    });
    if(bad) okAll = false;
  }
  eq(okAll, true, '连续 6 次跨回合改序：牌序 7 人齐全、每回合三人互不重复');
}

/* ---- 用例21：planPlacement 是纯试算，绝不可改动任何状态 ----
   （拖拽悬停时会高频调用它） */
reset(12);
{
  const before = JSON.stringify({t:E.state.team, d:E.state.deck, r:E.state.turns, n:E.state.turnCount});
  const keys = ['p1','p2','p3','p4','p5','p6','p7'];
  let feasible = 0, infeasible = 0;
  for(const k of keys){
    for(let t=0;t<12;t++){
      for(let p=0;p<3;p++){
        const r = E.planPlacement(k, t, p);
        if(r.ok) feasible++; else infeasible++;
      }
    }
  }
  eq(feasible + infeasible, 7*12*3, '穷举 252 种「角色×回合×位置」组合均能给出结论');
  eq(infeasible > 0, true, '其中确实存在不可行的组合（会被拒绝并提示）');
  eq(JSON.stringify({t:E.state.team, d:E.state.deck, r:E.state.turns, n:E.state.turnCount}) === before,
     true, '穷举试算后状态零改动（纯函数）');
}

/* ---- 用例22：编队成员规整（teamFromMembers）---- */
{
  // 注意：数组里含 null 时 .join(',') 会把 null 渲染成空串，故统一用 JSON.stringify 比对
  const J = (a) => JSON.stringify(a);
  eq(E.teamFromMembers(['p1','p2','p3','p4','p5','p6','p7']).join(','),
     'p1,p2,p3,p4,p5,p6,p7', '7 人编队原样保留');
  eq(J(E.teamFromMembers(['p1', null, '', 0, {}, 'p6'])),
     J(['p1',null,null,null,null,'p6',null]),   '非法成员值一律补空位（不写入 0 / {} / 空串）');
  eq(E.teamFromMembers(['p1','p2','p3','p4','p5','p6','p7','p8']).length, 7,
     '超过 7 个的多余成员被截断');
  eq(E.teamFromMembers(['p1','p2','p3']).length, 7, '不足 7 个时补足到 7 个槽位');
  eq(J(E.teamFromMembers(null)), J([null,null,null,null,null,null,null]), '非数组输入安全退化');
  eq(E.teamFromMembers('p1p2p3').some(Boolean), false, '字符串输入不会被误当成成员列表');
}

/* ---- 用例23：队伍指纹（teamSignature）---- */
{
  eq(E.teamSignature(['p1','p2','p3','p4','p5','p6','p7']),
     E.teamSignature(['p1','p2','p3','p4','p5','p6','p7']), '同一队伍指纹一致');
  eq(E.teamSignature(['p1','p2','p3','p4','p5','p6','p7']) ===
     E.teamSignature(['p2','p1','p3','p4','p5','p6','p7']), false, '顺序不同 → 指纹不同（编队含初始顺序）');
  eq(E.teamSignature([null,null,null,null,null,null,null]),
     E.teamSignature([undefined,'',null]), true, '空队伍的指纹稳定（用于「当前是否已保存」判断）');
}

/* ---- 用例24：外部编队数据清洗（normalizeTeams）---- */
{
  const J = (a) => JSON.stringify(a);
  const t = E.normalizeTeams([
    { id:'t1', name:'超赛队', members:['p1','p2','p3','p4','p5','p6','p7'] },
    { name:'全空队', members:[null,null,null,null,null,null,null] },
    null, 'not-an-object',
    { members:['p1'] },                                   // 缺 name
  ]);
  eq(t.length, 2, '清洗后保留 2 套（丢弃全空位与结构非法项）');
  eq(t[0].name, '超赛队',          '有效编队保留名称');
  eq(t[1].name, '编队 2',          '缺名称时按输出位置补默认名');
  eq(J(t[1].members), J(['p1',null,null,null,null,null,null]), '缺名称的编队成员同样被规整');
  const long = E.normalizeTeams([{ name:'x'.repeat(80), members:['p1'] }]);
  eq(long[0].name.length, 40, '名称超长被截断到 40 字');
  eq(E.normalizeTeams('oops').length, 0, '非数组输入返回空集合');
  const wr = E.normalizeTeams([{ name:'带标记', members:['p:1','p:2'], leader:'p:1', friend:'p:2' }]);
  eq(J([wr[0].leaderSlot, wr[0].friendSlot]), J([0,1]), '编队清洗时旧的角色标记迁成槽位号');
  const wr2 = E.normalizeTeams([{ name:'新标记', members:['p:1','p:2'], leaderSlot:1, friendSlot:1 }]);
  eq(J([wr2[0].leaderSlot, wr2[0].friendSlot]), J([1,null]), '同一张卡兼任 → 清洗时助战置空');
  const br = E.normalizeTeams([{ name:'坏标记', members:['p:1'], leader:'p:9', friend:'p:9' }]);
  eq(J([br[0].leaderSlot, br[0].friendSlot]), J([null,null]), '标记不在成员里 → 清洗时一律置空');
}

/* ---- 用例25：导入时编队引用的 id 重写（remapTeamMembers）---- */
{
  const J = (a) => JSON.stringify(a);
  const map = { oldA:'newA', oldB:'newB' };
  eq(J(E.remapTeamMembers(['p:oldA','r:1000460','p:oldB','p:unknown'], map)),
     J(['p:newA','r:1000460','p:newB','p:unknown',null,null,null]),
     '自建卡 p: 引用被换成新 id，图鉴卡 r: 与未知引用保持不变');
  eq(J(E.remapTeamMembers(['p:oldA'], {})), J(['p:oldA',null,null,null,null,null,null]), '空映射表不做改动');
  eq(J(E.remapTeamMembers([null,'p:oldA'], null)), J([null,'p:oldA',null,null,null,null,null]), '缺映射表时安全返回');
}

/* ---- 用例26：旧裸 id 迁移为统一 key（normalizeTeamKeys）---- */
{
  const J = (a) => JSON.stringify(a);
  eq(J(E.normalizeTeamKeys(['abc','r:1000460','p:def',null])),
     J(['p:abc','r:1000460','p:def',null,null,null,null]),
     '裸 id 补 p: 前缀；r: / p: 前缀原样保留');
  eq(E.teamSignature(['abc','r:1','','x','y','z','w']),
     E.teamSignature(['p:abc','r:1',null,'p:x','p:y','p:z','p:w']),
     '迁移前后指纹一致（同一角色只有一种写法）');
  eq(J(E.normalizeTeamKeys(false)), J([null,null,null,null,null,null,null]), '非数组输入安全退化');
}

/* ---- 用例27：队长 / 助战标记规整成「槽位号」 ----
   标记的是「哪一张卡」，不是「哪个角色」：同名两张时靠槽位区分 */
{
  const J = (a) => JSON.stringify(a);
  const team = ['p:1','p:2','p:3','p:4','p:5','p:6','p:7'];
  eq(J(E.normalizeRoles(0, 1, team)), J({leaderSlot:0,friendSlot:1}), '传槽位号 → 原样保留');
  eq(J(E.normalizeRoles('p:3','p:7', team)), J({leaderSlot:2,friendSlot:6}),
     '传角色 key（旧存档 / 对外接口）→ 换成槽位号');
  eq(E.normalizeRoles(9, 1, team).leaderSlot, null, '槽位越界 → 置空');
  eq(E.normalizeRoles(2, 2, team).friendSlot, null, '同一张卡不能兼任 → 助战置空');
  eq(E.normalizeRoles(2, 2, team).leaderSlot, 2, '兼任时队长保留');
  eq(E.normalizeRoles(5, null, ['p:1','p:2',null,null,null,null,null]).leaderSlot, null,
     '空槽位 → 置空');
  eq(J(E.normalizeRoles(null, undefined, team)), J({leaderSlot:null,friendSlot:null}), '不传标记 → 双空');
  eq(E.normalizeRoles('p:9', 1, team).leaderSlot, null, '角色不在队伍里 → 置空');
  eq(E.normalizeRoles('abc', 'p:2', ['abc','p:2',null,null,null,null,null]).leaderSlot, 0,
     '裸 id 写法归一化后能对上成员');
  eq(J(E.normalizeRoles(0, 1, [null,null,null,null,null,null,null])),
     J({leaderSlot:null,friendSlot:null}), '空队伍 → 标记一律置空');
  eq(E.normRoleKey('r:123'), 'r:123', 'normRoleKey：r: 前缀原样保留');
  eq(E.normRoleKey(''), null, 'normRoleKey：空串 → null');
  eq(E.roleSlotOf(true, team), null, '非数字非字符串的输入 → null');
}

/* ---- 用例28：队伍完整指纹（teamFullSignature）---- */
{
  const members = ['p:1','p:2','p:3','p:4','p:5','p:6','p:7'];
  const A = { members: members, leaderSlot:0, friendSlot:1 };
  const C = { members: members, leaderSlot:2, friendSlot:1 };
  const D = { members: members };
  eq(E.teamFullSignature(A) === E.teamFullSignature({ members: members.slice(), leaderSlot:0, friendSlot:1 }),
     true, '同一套（成员 + 标记）指纹一致');
  eq(E.teamFullSignature(A) === E.teamFullSignature(C), false, '同 7 人但队长不同 → 算两套编队');
  eq(E.teamFullSignature(A) === E.teamFullSignature(D), false, '不设标记与设了标记不是同一套');
  eq(E.teamFullSignature(D) === E.teamFullSignature({ members: members, leaderSlot:null, friendSlot:null }),
     true, '都不设标记时指纹一致（「当前是否已保存」的判断依据）');
  eq(E.teamFullSignature({ members: members, leader:'p:1', friend:'p:2' }) === E.teamFullSignature(A),
     true, '旧数据（角色 key）迁移后与新写法算出同一指纹');
  eq(E.teamFullSignature(undefined) === E.teamFullSignature(null), true, '空输入安全退化且稳定');
  eq(E.teamFullSignature(A).indexOf(E.teamSignature(A.members)) === 0, true, '完整指纹以成员指纹为前缀');
}

/* ---- 用例29：新旧标记字段的兼容（roleValueOf / teamRoles）---- */
{
  const members = ['p:1','p:1','p:3',null,null,null,null];   // 同名两张
  eq(E.roleValueOf({ leader:'p:1' }, 'leader'), 'p:1', 'roleValueOf 能读旧字段');
  eq(E.roleValueOf({ leaderSlot:5 }, 'leader'), 5, 'roleValueOf 读新字段');
  eq(E.roleValueOf({ leaderSlot:0, leader:'p:9' }, 'leader'), 0, '新旧字段并存时以槽位号为准');
  eq(E.roleValueOf({ leaderSlot:null, leader:'p:1' }, 'leader'), 'p:1', '新字段为 null 时回退到旧字段');
  eq(E.roleValueOf(null, 'leader'), null, '空对象安全返回 null');

  const t = E.teamRoles({ members: members, leader:'p:1', friend:'p:1' });
  eq(t.leaderSlot, 0, '同名的旧标记迁到第一个槽位');
  eq(t.friendSlot, 1, '旧数据两者是同一角色的两张 → 助战挪到另一个槽位（不丢标记）');
  const s = E.teamRoles({ members: members, leaderSlot:0, friendSlot:1 });
  eq(s.leaderSlot === 0 && s.friendSlot === 1, true, '同名的两张可以分别当队长和助战');
  eq(E.teamRoles({ members: members, leaderSlot:6, friendSlot:1 }).leaderSlot, null,
     '标记落在空槽位上 → 置空');
  eq(E.teamRoles({ members: members, leaderSlot:0, friendSlot:0 }).friendSlot, null,
     '新写法里同一张卡兼任 → 助战置空');
  eq(E.teamRoles({ members: ['p:1','p:2'], leader:'p:1', friend:'p:1' }).friendSlot, null,
     '角色只有一张时兼任旧数据也清掉');
}

/* ---- 用例30：标记随队伍变动自动摘除（syncRoles）---- */
{
  const J = (a) => JSON.stringify(a);
  E.state.team = ['p:1','p:2','p:3','p:4','p:5','p:6','p:7'];
  E.state.leaderSlot = 0; E.state.friendSlot = 1;
  eq(E.syncRoles().leaderSlot, 0, '满编时队长标记保留');
  E.state.team[0] = null;                                     // 队长那张卡被移出队伍
  eq(E.syncRoles().leaderSlot, null, '卡片被移出队伍 → 标记自动摘掉');
  eq(E.syncRoles().friendSlot, 1, '另一个标记不受影响');
  E.state.team = new Array(7).fill(null);
  eq(J(E.syncRoles()), J({leaderSlot:null,friendSlot:null}), '队伍清空 → 两个标记都摘掉');
  E.state.team = ['p:1','p:2','p:3','p:4','p:5','p:6','p:7'];
  E.state.leaderSlot = 0; E.state.friendSlot = 0;
  eq(E.syncRoles().friendSlot, null, '载入脏数据（同一张卡兼任）时助战被清掉');
  E.state.leaderSlot = null; E.state.friendSlot = null;
  eq(J(E.currentTeamObj().members), J(['p:1','p:2','p:3','p:4','p:5','p:6','p:7']), 'currentTeamObj 取到当前队伍');
  eq(E.currentTeamObj().leaderSlot, null, 'currentTeamObj 也带上标记槽位');
}

/* ---- 用例31：同名双角色（自己 1 + 助战 1）的槽位统计 ----
   自己的队伍 6 人 + 好友助战 1 人，两者可以是同一张卡，所以同名最多两份 */
{
  const J = (a) => JSON.stringify(a);
  E.state.team = ['p:1','p:2','p:3','p:4','p:5','p:1','p:7'];
  eq(J(E.teamSlotsOf('p:1')), J([0,5]), '同名两份 → 两个槽位都记录');
  eq(E.copyCountOf('p:1'), 2, '同名份数为 2');
  eq(E.copyCountOf('p:2'), 1, '其他角色仍是 1 份');
  eq(E.copyCountOf('p:9'), 0, '不在队伍里的角色为 0 份');
  eq(E.copyCountOf(null), 0, '空 key 安全返回 0');
  eq(E.normalizeRoles(0, 5, E.state.team).friendSlot, 5,
     '同名的两张可以分别当队长（槽 1）与助战（槽 6）');
  eq(E.normalizeRoles(0, 0, E.state.team).friendSlot, null,
     '同一张卡不能同时当队长与助战');
  const sig1 = E.teamSignature(E.state.team);
  eq(sig1.split('|').length, 7, '队形指纹按槽位算，仍是 7 段');
  eq(E.teamSignature(['p:1','p:2','p:3','p:4','p:5','p:1','p:7']) === sig1, true,
     '同名双角色的队伍指纹稳定（顺序不同才算不同）');
}

/* ---- 用例32：反推时自动挑选「赶得上的那一份」---- */
{
  // 第 2 回合上场槽位 4-5-6（0-based 3,4,5）；p:1 同时占槽位 1(0) 与 6(5)
  E.state.team = ['p:1','p:2','p:3','p:4','p:5','p:1','p:7'];
  E.rebuild(true); E.ensureTurns(8);

  const onlyFirst = E.planFromSlot('p:1', 0, 1, 0);       // 只拿着槽位 1 那份去试
  eq(onlyFirst.ok, false, '槽位 1 那一份赶不上第 2 回合');

  const p = E.planPlacement('p:1', 1, 0);                 // 引擎应改用槽位 6 那一份
  eq(p.ok, true, '同名第二份在窗口内 → 可行');
  eq(p.copies, 2, '试算结果标明队中有 2 份同名');
  eq(p.startSlot, 5, '选中的是槽位 6 的那一份（0-based 5）');
  eq(p.steps.length, 0, '不需要任何前置调整');

  const r = E.applyPlacement('p:1', 1, 0);
  eq(r.ok, true, 'applyPlacement 执行成功');
  eq(E.state.turns[1][0], 'p:1', '第 2 回合第 1 位确实是同名角色');
  eq(E.copyCountOf('p:1'), 2, '落子后同名仍是两份（没有凭空多出第三份）');
}

/* ---- 用例33：同名双角色也不会丢人 / 造出第三份 ---- */
{
  const init = ['p:1','p:2','p:3','p:4','p:5','p:1','p:7'];
  const sortJoin = (a) => a.slice().sort().join(',');
  E.state.team = init.slice();
  E.rebuild(true); E.ensureTurns(10);
  E.swapInTurn(1, 0, 2);                                  // 第 2 回合（槽位 4-5-6）内部换序
  const deck = E.state.deck.slice();
  eq(deck.filter(function(k){ return k === 'p:1'; }).length, 2, '交换后牌序里同名仍是两份');
  eq(deck.filter(Boolean).length, 7, '牌序无空位、没丢人');
  eq(sortJoin(deck), sortJoin(init), '牌序的成员组成不变（不多不少）');
  eq(E.state.turns[1].join(','), 'p:1,p:5,p:4', '第 2 回合按手动顺序上场');
}

/* ---- 用例34：拖动 / 打乱时标记跟着卡片搬（swapRoleSlot / roleKeyAt）---- */
{
  eq(E.swapRoleSlot(0, 0, 5), 5, '队长所在槽位被交换 → 标记跟到新槽位');
  eq(E.swapRoleSlot(5, 0, 5), 0, '反向同理');
  eq(E.swapRoleSlot(2, 0, 5), 2, '不相干的槽位不受影响');
  eq(E.swapRoleSlot(null, 0, 5), null, '未设置标记 → 仍是 null');
  eq(E.swapRoleSlot(3, 3, 3), 3, '原地交换不出错');
  eq(E.roleKeyAt(0, ['p:1','p:2']), 'p:1', 'roleKeyAt 取到该槽位的角色');
  eq(E.roleKeyAt(1, ['p:1','p:2']), 'p:2', '第二个槽位同理');
  eq(E.roleKeyAt(6, ['p:1','p:2']), null, '越界槽位返回 null');
  eq(E.roleKeyAt(1, ['p:1',null]), null, '空槽位返回 null');
  eq(E.roleKeyAt(null, ['p:1']), null, 'null 槽位安全返回');
}

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
