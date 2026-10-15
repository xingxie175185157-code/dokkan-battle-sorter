/**
 * 从 DOKKAN.FYI 抓取全角色数据（英文原始数据）
 *
 * 数据来源：https://dokkan.fyi
 *   - 站点为社区数据库，每页均为服务端渲染，并专门提供 Markdown 版本（URL 加 .md）
 *   - 站点在 robots.txt / llms.txt 中明确欢迎 AI 助手读取与引用，仅要求注明来源
 *
 * 产出：data/raw-roster.json
 *   [{ id, nameEn, titleEn, rarity, cls, typeEn, cost, maxLevel, released,
 *      linksEn:[], categoriesEn:[{id,name}], thumb, pageUrl }]
 *
 * 用法： node tools/crawl.mjs [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const OUT = path.join(ROOT, 'data', 'raw-roster.json');
const BASE = 'https://dokkan.fyi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) dokkan-sorter/1.0 (personal team-builder tool)';

const args = process.argv.slice(2);
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : Infinity;
})();
const CONCURRENCY = 5;

fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带缓存与重试的抓取 */
async function get(url, { cacheFile, binary = false } = {}) {
  if (cacheFile) {
    const p = path.join(CACHE, cacheFile);
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf8');
      if (txt.length > 0) return txt;
    }
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      if (cacheFile) fs.writeFileSync(path.join(CACHE, cacheFile), txt, 'utf8');
      return txt;
    } catch (e) {
      lastErr = e;
      await sleep(400 * attempt);
    }
  }
  throw new Error('抓取失败 ' + url + ' :: ' + lastErr.message);
}

/** 简单并发池 */
async function pool(items, worker, size = CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done++;
      if (done % 50 === 0) process.stdout.write(`  进度 ${done}/${items.length}\n`);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

/* ---------- 1. 枚举角色 id ---------- */
async function collectIds() {
  const ids = new Map();
  for (let page = 1; page <= 130; page++) {
    const html = await get(`${BASE}/characters?page=${page}`, { cacheFile: `list-${page}.html` });
    // 列表页内嵌 JSON-LD ItemList，含 position / url / name
    const blocks = [...html.matchAll(/"url":\s*"https:\/\/dokkan\.fyi\/characters\/(\d+)",\s*"name":\s*"((?:[^"\\]|\\.)*)"/g)];
    if (!blocks.length) {
      console.log(`  列表第 ${page} 页为空，枚举结束`);
      break;
    }
    for (const [, id, rawName] of blocks) {
      let name = rawName.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
      ids.set(id, name);
    }
    if (page % 20 === 0) console.log(`  已枚举 ${ids.size} 张（第 ${page} 页）`);
  }
  return ids;
}

/* ---------- 2. 解析单个角色的 Markdown ---------- */
function parseMd(md, id, fallbackName) {
  const rec = {
    id,
    nameEn: fallbackName || '',
    titleEn: '',
    rarity: '',
    cls: '',
    typeEn: '',
    cost: null,
    maxLevel: null,
    released: '',
    linksEn: [],
    categoriesEn: [],
    thumb: '',
    pageUrl: `${BASE}/characters/${id}`,
  };

  // 标题行可能折行（如 "…Goku (Angel) &" 换行 "Vegeta (Angel)"），需按空行拼接续行
  const lines = md.split('\n');
  const hi = lines.findIndex((l) => l.startsWith('# '));
  if (hi >= 0) {
    let heading = lines[hi].slice(2).trim();
    for (let j = hi + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t || t.startsWith('-') || t.startsWith('#') || t.startsWith('|')) break;
      heading += ' ' + t;
    }
    heading = heading.replace(/\s+/g, ' ').trim();
    const head = heading.match(/^\[(.+?)\]\s*(.+)$/);
    if (head) {
      rec.titleEn = head[1].trim();
      rec.nameEn = head[2].trim();
    } else {
      rec.nameEn = heading;
    }
  }

  const rt = md.match(/^- Rarity and Type:\s*(.+)$/m);
  if (rt) {
    const parts = rt[1].trim().split(/\s+/);
    rec.rarity = parts[0] || '';
    if (parts.length >= 3) {
      rec.cls = parts[parts.length - 2];
      rec.typeEn = parts[parts.length - 1];
    } else if (parts.length === 2) {
      rec.typeEn = parts[1];
    }
  }

  const cost = md.match(/^- Cost:\s*(\d+)/m);
  if (cost) rec.cost = parseInt(cost[1], 10);
  const lvl = md.match(/^- Max Level:\s*(\d+)/m);
  if (lvl) rec.maxLevel = parseInt(lvl[1], 10);
  const rel = md.match(/^- Released:\s*([\d-]+)/m);
  if (rel) rec.released = rel[1];

  // Link Skills：小节下的 **名称**
  const linksSec = md.split(/^##\s+Link Skills\s*$/m)[1];
  if (linksSec) {
    const body = linksSec.split(/^##\s/m)[0];
    for (const m of body.matchAll(/^-\s+\*\*(.+?)\*\*\s*$/gm)) {
      const n = m[1].trim();
      if (n && !rec.linksEn.includes(n)) rec.linksEn.push(n);
    }
  }

  // Categories：[名称](url)
  const catSec = md.split(/^##\s+Categories\s*$/m)[1];
  if (catSec) {
    const body = catSec.split(/^##\s/m)[0];
    for (const m of body.matchAll(/^-\s*\[([^\]]+)\]\(([^)]+)\)/gm)) {
      const name = m[1].trim();
      const url = m[2].trim();
      if (name && !rec.categoriesEn.some((c) => c.name === name)) {
        rec.categoriesEn.push({ id: (url.match(/\/(\d+)\s*$/) || [])[1] || '', name });
      }
    }
  }

  // 头像：图片 id 为卡片 id 去掉末位（游戏内同立绘分组）
  const imgId = String(Math.floor(Number(id) / 10) * 10);
  rec.thumb = `https://cdn.dokkan.fyi/assets/en/character/thumb/card_${imgId}_thumb/card_${imgId}_thumb.png`;

  return rec;
}

/* ---------- 主流程 ---------- */
(async () => {
  console.log('① 枚举角色列表 …');
  const ids = await collectIds();
  let list = [...ids.entries()].map(([id, name]) => ({ id, name }));
  console.log(`   共发现 ${list.length} 张卡`);
  if (LIMIT !== Infinity) list = list.slice(0, LIMIT);

  console.log('② 抓取角色详情（Markdown）…');
  const roster = await pool(list, async ({ id, name }) => {
    try {
      const md = await get(`${BASE}/characters/${id}.md`, { cacheFile: `char-${id}.md` });
      return parseMd(md, id, name);
    } catch (e) {
      console.warn(`  ! ${id} 失败：${e.message}`);
      return { id, nameEn: name, error: e.message };
    }
  });

  const ok = roster.filter((r) => !r.error);
  fs.writeFileSync(OUT, JSON.stringify(ok, null, 1), 'utf8');
  console.log(`\n完成：${ok.length}/${roster.length} 张 → ${path.relative(ROOT, OUT)}`);

  // 统计出现的链接技能与分类，供翻译表使用
  const links = new Set();
  const cats = new Map();
  for (const r of ok) {
    r.linksEn.forEach((l) => links.add(l));
    r.categoriesEn.forEach((c) => cats.set(c.name, c.id));
  }
  const via = { links: [...links].sort(), categories: [...cats.entries()].map(([name, id]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
  fs.writeFileSync(path.join(ROOT, 'data', 'enums-en.json'), JSON.stringify(via, null, 1), 'utf8');
  console.log(`枚举到 ${via.links.length} 个链接技能 / ${via.categories.length} 个分类 → data/enums-en.json`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
