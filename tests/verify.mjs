// 端到端校验：DOM 契约 + roster 数据 + 索引解析 + 与源数据一致性 + CDN 可达性
// 卡牌字段: [0]id [1]nameZh [2]nameEn [3]titleEn [4]rarity [5]cls
//          [6]typeEn [7]typeKey [8]imgId [9]links[] [10]cats[] [11]released
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('OK   ' + m); } else { fail++; console.log('FAIL ' + m); } };
const info = (m) => console.log('--   ' + m);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const rosterSrc = fs.readFileSync(path.join(ROOT, 'roster.js'), 'utf8');
const rawJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/raw-roster.json'), 'utf8'));
const rawList = Array.isArray(rawJson) ? rawJson : rawJson.cards;
const rawById = new Map(rawList.map(c => [String(c.id), c]));

// 官方保留的拉丁专名（游戏内即为拉丁写法，属正确译文，不计为"未汉化"）
const LATIN_OK = new Set(['GT', 'GT BOSS', 'GT HERO']);

// 1. 语法
try { new vm.Script(rosterSrc); ok(true, 'roster.js 语法正确'); }
catch (e) { ok(false, 'roster.js 语法: ' + e.message); }

let inlineSrc = '';
for (const blk of html.match(/<script>([\s\S]*?)<\/script>/g) || []) {
  const body = blk.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (body.includes('function startSlot')) inlineSrc = body;
}
ok(!!inlineSrc, '提取到主内联脚本');
try { new vm.Script(inlineSrc); ok(true, 'index.html 内联脚本语法正确'); }
catch (e) { ok(false, '内联脚本语法: ' + e.message); }

// 2. DOM id 契约（仅取 byId/getElementById 与 $('#id')，排除 CSS 选择器）
const declared = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(x => x[1]));
const referenced = new Set();
for (const r of inlineSrc.matchAll(/(?:getElementById|byId)\(\s*['"]([^'"]+)['"]/g)) referenced.add(r[1]);
for (const r of inlineSrc.matchAll(/\$\(\s*['"]#([A-Za-z0-9_-]+)['"]/g)) referenced.add(r[1]);
const missing = [...referenced].filter(id => !declared.has(id));
ok(missing.length === 0, `DOM id 引用完整 (引用 ${referenced.size} 个, 缺失 ${missing.length}${missing.length ? ' → ' + missing.join(',') : ''})`);

// 3. roster 数据
const ctx = { window: {} }; ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(rosterSrc, ctx);
const R = ctx.DOKKAN_ROSTER;
ok(!!R, 'window.DOKKAN_ROSTER 已挂载');
ok(R.count === R.cards.length && R.count === rawList.length, `卡牌数与源数据一致 (${R.count} = ${rawList.length})`);
ok(Array.isArray(R.links) && R.links.length > 0, `链接技能表 ${R.links.length} 项`);
ok(Array.isArray(R.cats) && R.cats.length > 0, `分类表 ${R.cats.length} 项`);
ok(R.source === 'https://dokkan.fyi', `来源标注: ${R.source}`);

// 4. 字段完整性 / 索引 / 取值域
const RARITY = new Set(['LR', 'UR', 'SSR', 'SR', 'R', 'N']);
const TYPE = new Set(['str', 'agl', 'teq', 'int', 'phy', 'none']);
let lenBad = 0, missField = 0, badIdx = 0, badRar = 0, badType = 0, noName = 0, noImg = 0, dupId = 0, lostLink = 0, lostCat = 0;
const seenId = new Set();
for (const c of R.cards) {
  if (!Array.isArray(c) || c.length !== 12) { lenBad++; continue; }
  const [id, nz, ne, ti, rar, cls, tEn, tk, img, ln, ct] = c;
  if (seenId.has(id)) dupId++; seenId.add(id);
  if (!id || !rar || !tk) missField++;
  if (!RARITY.has(rar)) badRar++;
  if (!TYPE.has(tk)) badType++;
  if (!nz && !ne) noName++;
  if (!img) noImg++;
  if (!Array.isArray(ln) || !Array.isArray(ct)) { missField++; continue; }
  for (const i of ln) if (!(i >= 0 && i < R.links.length)) badIdx++;
  for (const i of ct) if (!(i >= 0 && i < R.cats.length)) badIdx++;
  // 关键不变量：构建过程不得丢失源数据中存在的链接/分类
  const raw = rawById.get(id);
  if (raw) {
    if ((raw.linksEn || []).length > 0 && ln.length === 0) lostLink++;
    if ((raw.categoriesEn || []).length > 0 && ct.length === 0) lostCat++;
  }
}
ok(lenBad === 0, `卡牌长度一致 (异常 ${lenBad})`);
ok(dupId === 0, `无重复卡 id (重复 ${dupId})`);
ok(missField === 0, `关键字段非空 (缺失 ${missField})`);
ok(badIdx === 0, `链接/分类索引解析 (越界 ${badIdx})`);
ok(badRar === 0, `稀有度取值合法 (异常 ${badRar})`);
ok(badType === 0, `属性键取值合法 (异常 ${badType})`);
ok(noName === 0, `每张卡都有名字 (空名 ${noName})`);
ok(noImg === 0, `每张卡都有图 id (缺图 ${noImg})`);
ok(lostLink === 0, `未丢失源数据的链接技能 (丢失 ${lostLink})`);
ok(lostCat === 0, `未丢失源数据的分类 (丢失 ${lostCat})`);

// 5. 中文覆盖
const zhName = R.cards.filter(c => /[\u4e00-\u9fff]/.test(c[1] || '')).length;
ok(zhName === R.cards.length, `角色名中文化 (${zhName}/${R.cards.length} = ${(zhName / R.cards.length * 100).toFixed(1)}%)`);
const linkZh = R.links.filter(s => /[\u4e00-\u9fff]/.test(s) || LATIN_OK.has(s)).length;
const catZh = R.cats.filter(s => /[\u4e00-\u9fff]/.test(s) || LATIN_OK.has(s)).length;
ok(linkZh === R.links.length, `链接技能名中文化 (${linkZh}/${R.links.length}，含官方拉丁专名)`);
ok(catZh === R.cats.length, `分类名中文化 (${catZh}/${R.cats.length}，含官方拉丁专名)`);
const residualName = [...new Set(R.cards.flatMap(c => (c[2] || '').match(/[A-Za-z]+\.?/g) || []))];
info(`称号字段保持英文（唯一称号 ${new Set(R.cards.map(c => c[3]).filter(Boolean)).size} 条，为卡面 flavor text）`);

// 6. 分布
const dist = {};
for (const c of R.cards) dist[c[4]] = (dist[c[4]] || 0) + 1;
info('稀有度分布: ' + ['LR', 'UR', 'SSR', 'SR', 'R', 'N'].filter(k => dist[k]).map(k => `${k} ${dist[k]}`).join(' / '));
const emptyLink = R.cards.filter(c => c[9].length === 0).length;
const emptyCat = R.cards.filter(c => c[10].length === 0).length;
info(`源数据本身即无链接/分类的卡: 链接空 ${emptyLink} 张 / 分类空 ${emptyCat} 张（非构建丢失）`);

// 7. CDN 封面抽样可达（离线时降级为跳过，不阻塞 CI）
const step = Math.max(1, Math.floor(R.cards.length / 6));
const sample = R.cards.filter((_, i) => i % step === 0).slice(0, 6);
let cdnOk = 0, netErr = 0;
for (const c of sample) {
  const url = `https://cdn.dokkan.fyi/assets/en/character/thumb/card_${c[8]}_thumb/card_${c[8]}_thumb.png`;
  try { if ((await fetch(url, { method: 'HEAD' })).status === 200) cdnOk++; else netErr++; } catch { netErr++; }
}
if (cdnOk === 0 && netErr === sample.length) {
  info(`跳过封面 CDN 抽样：网络不可达（${sample.length} 张全部请求失败）`);
} else {
  ok(cdnOk === sample.length, `封面 CDN 抽样可达 (${cdnOk}/${sample.length})`);
}

// 8. 前端加载
ok(/roster\.js/.test(html), 'index.html 会加载 roster.js');

// 9. 交互功能存在性（新增：星标高亮 + 拖拽反推）
const needFns = ['isKept', 'keepToMine', 'unkeepFromMine', 'planPlacement', 'applyPlacement',
                 'reachableSlots', 'goodSets', 'deckAt', 'applyTurnOrder', 'placeCharacter',
                 'placementHintHTML', 'dragSourceKey', 'showHint', 'endDrag', 'setAutoMarks'];
const missFn = needFns.filter(f => !new RegExp('function\\s+' + f + '\\s*\\(').test(inlineSrc));
ok(missFn.length === 0, `关键函数已定义 (${needFns.length} 个${missFn.length ? '，缺失: ' + missFn.join(',') : ''})`);

ok(/data-act="unkeep"/.test(inlineSrc) && /kept \? ' kept' : ''/.test(inlineSrc), '图鉴卡按「是否已收藏」渲染 ★ / ☆');
ok(/\.preset-item\.kept \.ops\{opacity:1;\}/.test(html) && /\.icon-btn\.kept/.test(html), '★ 高亮样式已定义');
ok(/id="dragHint"/.test(html) && /#dragHint\{/.test(html), '拖拽实时提示条已就位');
ok(/dragEffect|dropEffect\s*=\s*'none'/.test(inlineSrc), '不可行时不 preventDefault（浏览器显示禁止光标）');
ok(/deckAt\(st\.turn\)/.test(inlineSrc) && /deckAt\(T\)/.test(inlineSrc), '反推基于重放牌序，而非过期快照');

// 10. 拖拽来源齐备：图鉴项 / 队伍格 / 牌序条 / 回合卡 都可拖
ok(/preset-item[^']*' \+ \(kept \? ' kept' : ''\)[\s\S]{0,160}draggable="true"/.test(inlineSrc)
   || /'draggable="true" title="点击查看详情/.test(inlineSrc), '图鉴卡可拖拽');
ok(/chip[^']*'\s*\+\s*\(on\?' hi':''\)\s*\+\s*'" draggable="true" data-slot/.test(inlineSrc), '牌序条可拖拽');
ok(/kind:'lib'/.test(inlineSrc) && /kind:'deck'/.test(inlineSrc) &&
   /kind:'team'/.test(inlineSrc) && /kind:'turn'/.test(inlineSrc), '四种拖拽来源均已实现');

// 11. 出场回合汇总：必须走统一 key 解析（resolve/dispName），不得用只认自建卡的 byId
const sumBody = (inlineSrc.match(/function renderSummary\(\)\{[\s\S]*?\n\}/) || [''])[0];
ok(/var c = resolve\(id\)/.test(sumBody), '汇总表用 resolve() 解析统一 key');
ok(/dispName\(c\)/.test(sumBody), '汇总表用 dispName() 显示名字');
ok(!/byId\(/.test(sumBody), '汇总表不再直接调用 byId()（图鉴 key 会解析失败）');

// 12. 编队（队伍预设）
for (const id of ['teamPresets', 'maskTeam', 'teamName', 'teamPreview', 'teamCancel', 'teamConfirm']) {
  ok(new RegExp(`id="${id}"`).test(html), `编队相关 DOM 节点存在：#${id}`);
}
const teamFns = ['teamFromMembers', 'teamSignature', 'normalizeTeams', 'remapTeamMembers',
                 'renderTeamPresets', 'applyTeamPreset', 'removeTeamPreset', 'openTeamModal',
                 'confirmTeamModal', 'importTeamArray', 'importBundle', 'importResultText'];
const missTeam = teamFns.filter(f => !new RegExp('function\\s+' + f + '\\s*\\(').test(inlineSrc));
ok(missTeam.length === 0, `编队相关函数已定义 (${teamFns.length} 个${missTeam.length ? '，缺失: ' + missTeam.join(',') : ''})`);
ok(/renderTeam\(\);\s*\n\s*renderRoles\(\);\s*\n\s*renderTeamPresets\(\);/.test(inlineSrc),
   'renderAll 会重绘编队快捷位与队长/好友选择器');
ok(/LS_TEAMS\s*=\s*'dbs_sorter_teams_v1'/.test(inlineSrc), '编队有独立的 localStorage 键');
ok(/localStorage\.setItem\(LS_TEAMS/.test(inlineSrc), 'save() 会持久化编队');
ok(/normalizeTeams\(tp\)/.test(inlineSrc), 'load() 会读回并清洗编队');
// 导出必须同时含 presets 与 teams，且导入兼容两者
ok(/presets:presets,\s*teams:teams/.test(inlineSrc), '导出 JSON 同时包含 presets 与 teams');
ok(/version:\s*2/.test(inlineSrc) && /Array\.isArray\(data\.teams\)/.test(inlineSrc), '导入支持 teams 段（收藏库备份 v2）');
// 「只存人」的约定：编队里不得出现回合排程相关字段
const tpPush = (inlineSrc.match(/teams\.push\(\{[^}]*\}\)/) || [''])[0];
ok(tpPush.length > 0 && !/turns|deck|turnCount/.test(tpPush), '编队只保存成员与初始顺序，不含回合排程');

// 13. 队长 / 好友标记
for (const id of ['roleBar', 'selLeader', 'selFriend']) {
  ok(new RegExp(`id="${id}"`).test(html), `队长/好友相关 DOM 节点存在：#${id}`);
}
const roleFns = ['normRoleKey', 'normalizeRoles', 'syncRoles', 'teamFullSignature',
                 'currentTeamObj', 'remapRoleKey', 'renderRoles', 'roleTagWith',
                 'roleTagOf', 'setRole'];
const missRole = roleFns.filter(f => !new RegExp('function\\s+' + f + '\\s*\\(').test(inlineSrc));
ok(missRole.length === 0, `队长/好友相关函数已定义 (${roleFns.length} 个${missRole.length ? '，缺失: ' + missRole.join(',') : ''})`);
// save() 落盘前必须先对齐标记（保证「标记 ⊆ 队伍成员」这条不变量）
const saveBody = (inlineSrc.match(/function save\(\)\{[\s\S]*?\n\}/) || [''])[0];
ok(/syncRoles\(\)/.test(saveBody), 'save() 落盘前会同步队长/好友标记');
ok(/leader:\s*state\.leader,\s*friend:\s*state\.friend/.test(saveBody), '存档里包含 leader / friend');
// 编队预设必须携带标记
ok(/leader:\s*r\.leader,\s*friend:\s*r\.friend/.test(inlineSrc), '编队预设保存队长/好友标记');
ok(/remapRoleKey\(t\.leader,\s*idMap\)/.test(inlineSrc), '导入时重写标记里的自建卡 id');
// 「当前」高亮改用完整指纹（同 7 人但队长不同 → 不算同一套）
ok(/teamFullSignature\(currentTeamObj\(\)\)/.test(inlineSrc), '编队「当前」高亮按完整指纹判定');
// 显示点：队伍格 / 牌序条 / 回合卡 / 汇总 四处都要有标记
ok(/roleTagOf\(key\)/.test((inlineSrc.match(/function renderTeam\(\)\{[\s\S]*?\n\}/) || [''])[0]), '队伍格显示队长/好友标记');
ok(/roleTagOf\(state\.deck\[i\]\)/.test(inlineSrc), '当前牌序显示队长/好友标记');
ok(/roleTagOf\(key\)/.test((inlineSrc.match(/function cardHTML\([\s\S]*?\n\}/) || [''])[0]), '回合卡片显示队长/好友标记');
ok(/roleTagOf\(id\)/.test((inlineSrc.match(/function renderSummary\(\)\{[\s\S]*?\n\}/) || [''])[0]), '出场回合汇总显示队长/好友标记');
for (const api of ['getRoles', 'setLeader', 'setFriend']) {
  ok(new RegExp(api + '\\s*:').test(inlineSrc), `对外接口暴露 ${api}()`);
}
ok(/version:\s*'2\.3\.0'/.test(inlineSrc), '应用版本号已升到 2.3.0');

const s = R.cards[0];
console.log(`\n样卡: ${s[4]} ${s[1]} | ${s[2]} | ${s[5]} ${s[6]} | 链接 ${s[9].map(i => R.links[i]).join('、')}`);
console.log(`      分类 ${s[10].map(i => R.cats[i]).join('、')}`);
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
