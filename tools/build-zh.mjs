/**
 * 把英文原始数据 + 中文对照表 → 生成前端可直接 <script> 引入的 data/roster.js
 *
 * 用法： node tools/build-zh.mjs
 * 产出： data/roster.js   （window.DOKKAN_ROSTER）
 *        data/report.txt  （翻译覆盖率与未命中词，便于补表）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'raw-roster.json'), 'utf8'));
const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'i18n-zh.json'), 'utf8'));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* 按长度倒序，长词优先，避免 "Super Saiyan" 抢掉 "Super Saiyan God SS" */
const TERMS = Object.entries(i18n.nameTerms).sort((a, b) => b[0].length - a[0].length);
const BOUND = (t) => new RegExp('(?<![A-Za-z0-9])' + esc(t) + '(?![A-Za-z0-9])', 'g');

const residual = new Map(); // 未翻译片段统计

function translateName(en) {
  let out = en;
  for (const [from, to] of TERMS) out = out.replace(BOUND(from), to);
  out = out
    .replace(/\(/g, '（').replace(/\)/g, '）')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*（\s*/g, '（').replace(/\s*）\s*/g, '）')
    // 所有格兜底：中文后遗留的 's 一律改为「的」（防止术语表漏项）
    .replace(/([\u4e00-\u9fff])['’]s\b/g, '$1的')
    // 中文之间不留空格（英文术语被替换后留下的分隔空格）；
    // 但 " & " / " + " 两侧必须保留空格
    .replace(/(?<=[\u4e00-\u9fff0-9A-Za-z])\s+(?=[\u4e00-\u9fff])/g, '')
    .replace(/(?<=[\u4e00-\u9fff])\s+(?=[（A-Za-z0-9])/g, '')
    .replace(/(?<=[\u4e00-\u9fff])\s+(?=[（])/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // 记录残留的英文单词（白名单已允许的缩写/专名除外）
  // GT=龙珠GT  SS=超级赛亚人缩写  RR=红绸军  Jr.=Jr.  MAX=沙鲁MAX
  // Dokkan=Dokkan武斗传  A/B=悟天克斯（失败）A/B
  const allowed = /^(GT|SS|RR|Z|Jr\.|MAX|X|AI|EX|Dokkan|A|B)$/;
  for (const w of out.match(/[A-Za-z]+\.?/g) || []) {
    if (!allowed.test(w)) residual.set(w, (residual.get(w) || 0) + 1);
  }
  return out;
}

/* ---------- 索引表：链接技能 / 分类 ---------- */
const linksZh = [];
const linksIdx = new Map();
const catsZh = [];
const catsIdx = new Map();
const missingLinks = new Set();
const missingCats = new Set();

function li(name) {
  if (!linksIdx.has(name)) { linksIdx.set(name, linksZh.length); linksZh.push(i18n.links[name] || name); }
  return linksIdx.get(name);
}
function ci(name) {
  if (!catsIdx.has(name)) { catsIdx.set(name, catsZh.length); catsZh.push(i18n.categories[name] || name); }
  return catsIdx.get(name);
}

/* ---------- 组装 ---------- */
const cards = raw.map((c) => {
  c.linksEn.forEach((n) => { if (!i18n.links[n]) missingLinks.add(n); });
  c.categoriesEn.forEach((x) => { if (!i18n.categories[x.name]) missingCats.add(x.name); });
  const typeEn = (c.typeEn || '').toUpperCase();
  const imgId = String(Math.floor(Number(c.id) / 10) * 10);
  return [
    String(c.id),
    translateName(c.nameEn),
    c.nameEn,
    c.titleEn,
    c.rarity,
    c.cls,
    typeEn,
    i18n.typeKeys[typeEn] || 'none',
    imgId,
    c.linksEn.map(li),
    c.categoriesEn.map((x) => ci(x.name)),
    c.released || '',
  ];
});

// 按稀有度（LR>UR>SSR>SR>R>N）再按 id 倒序（新卡在前）排序
const RANK = { LR: 0, UR: 1, SSR: 2, SR: 3, R: 4, N: 5 };
cards.sort((a, b) => (RANK[a[4]] ?? 9) - (RANK[b[4]] ?? 9) || Number(b[0]) - Number(a[0]));

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: 'https://dokkan.fyi',
  count: cards.length,
  links: linksZh,
  cats: catsZh,
  cards,
};

// 直接输出到 index.html 同级目录，前端以 <script src="roster.js"> 懒加载
fs.writeFileSync(
  path.join(ROOT, 'roster.js'),
  '/* 由 tools/build-zh.mjs 生成，数据来源 https://dokkan.fyi（社区数据库，robots/llms.txt 允许引用） */\n' +
  'window.DOKKAN_ROSTER=' + JSON.stringify(payload) + ';\n',
  'utf8'
);

/* ---------- 报告 ---------- */
const lines = [];
lines.push('卡牌总数: ' + cards.length);
lines.push('链接技能: ' + linksZh.length + ' 项，未命中对照表: ' + (missingLinks.size ? [...missingLinks].join(' | ') : '无'));
lines.push('分类: ' + catsZh.length + ' 项，未命中对照表: ' + (missingCats.size ? [...missingCats].join(' | ') : '无'));
lines.push('角色名残留英文词（按出现次数）:');
[...residual.entries()].sort((a, b) => b[1] - a[1]).forEach(([w, n]) => lines.push('  ' + w + ' × ' + n));
lines.push('');
lines.push('=== 抽样（前 12 张） ===');
cards.slice(0, 12).forEach((c) => {
  lines.push(`${c[4]} ${c[1]}  |  ${c[2]}  |  ${c[5]} ${c[6]}  |  链接 ${c[9].map((i) => linksZh[i]).join('/')}  |  分类 ${c[10].map((i) => catsZh[i]).join('/')}`);
});
fs.writeFileSync(path.join(ROOT, 'data', 'report.txt'), lines.join('\n'), 'utf8');

console.log(lines.slice(0, 4).join('\n'));
console.log('\n残留英文词 Top20:');
console.log([...residual.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w, n]) => w + '×' + n).join('  ') || '（无）');
console.log('\n已生成 roster.js  (' + (fs.statSync(path.join(ROOT, 'roster.js')).size / 1024).toFixed(0) + ' KB)');
console.log('详细报告： data/report.txt');
