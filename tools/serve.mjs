#!/usr/bin/env node
/**
 * 零依赖静态服务器 —— 只是为「不想双击 file:// 打开」的场景提供一个本地 http 环境。
 *
 *   node tools/serve.mjs            # 默认 http://127.0.0.1:8080
 *   node tools/serve.mjs 3000       # 指定端口
 *
 * 说明：index.html 通过 <script src="roster.js"> 注入数据，file:// 下本来就能直接跑；
 *      本脚本仅供需要 http 协议的场景（例如浏览器对 file:// 有额外限制）使用。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8080;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/index.html';

  // 防目录穿越：解析后必须仍在 ROOT 之内
  const file = path.resolve(ROOT, '.' + path.posix.normalize(rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found: ' + rel);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`龙珠爆裂大战 · 战斗排序器  →  http://${HOST}:${PORT}/`);
  console.log('按 Ctrl+C 停止');
});
