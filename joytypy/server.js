// 敲敲乐（JoyTypy）极简本地服务器
// 零依赖，仅监听 127.0.0.1；托管静态文件 + /api/lessons 列表 + /api/lessons/:name 读文件 + /api/shutdown 优雅退出
// 安全：路径穿越防护（decode + resolve + 前缀校验 + 文件名白名单）
// 固定端口，保证浏览器 localStorage 始终使用同一个 origin；空闲 30 分钟自退

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_DIR = path.join(ROOT, 'lessons');
const BASE_PORT = 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// 白名单：课文文件名仅含安全字符（中文/字母/数字/下划线/点/连字符），且以 .txt/.md 结尾
const LESSON_RE = /^[一-龥a-zA-Z0-9_.\-]+\.(txt|md)$/i;

// 安全解析：归一化绝对路径并校验前缀，越界返回 null
function safeResolve(baseDir, relPath) {
  const p = path.resolve(baseDir, relPath);
  return (p === baseDir || p.startsWith(baseDir + path.sep)) ? p : null;
}

let lastActive = Date.now();
const IDLE_TIMEOUT = 30 * 60 * 1000; // 空闲 30 分钟自动退出

const server = http.createServer((req, res) => {
  // 先解码 URL；解码失败（畸形 %）直接拒绝
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.statusCode = 400;
    return res.end('bad request');
  }

  // 优雅退出：仅本机可触发
  if (url === '/api/shutdown') {
    if (req.socket.remoteAddress !== '127.0.0.1') {
      res.statusCode = 403;
      return res.end('forbidden');
    }
    res.end('bye');
    gracefulExit();
    return;
  }

  lastActive = Date.now();

  // 课文列表 API
  if (url === '/api/lessons') {
    try {
      const files = fs.readdirSync(LESSONS_DIR)
        .filter(f => LESSON_RE.test(f))
        .sort()
        .map(f => {
          const txt = fs.readFileSync(path.join(LESSONS_DIR, f), 'utf8');
          return { name: f, chars: (txt.match(/[一-龥]/g) || []).length };
        });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify(files));
    } catch (e) {
      res.statusCode = 500;
      return res.end('server error');
    }
  }

  // 单篇课文读取 API
  if (url.startsWith('/api/lessons/')) {
    const name = url.slice('/api/lessons/'.length);
    if (!LESSON_RE.test(name)) {
      res.statusCode = 400;
      return res.end('bad name');
    }
    const p = safeResolve(LESSONS_DIR, name);
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(fs.readFileSync(p, 'utf8'));
  }

  // 静态文件：去掉前导 /，避免路径被绝对化
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const fp = safeResolve(ROOT, rel);
  if (!fp || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
    res.statusCode = 404;
    return res.end('404');
  }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  // 禁止缓存：确保用户总是看到最新版本的文件（儿童场景：家长不会手动清缓存）
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end(fs.readFileSync(fp));
});

function gracefulExit() {
  try {
    const pidFile = path.join(ROOT, 'server.pid');
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch (e) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  try {
    const p = spawn(cmd, [url]);
    p.on('error', () => console.error(`无法自动打开浏览器，请手动访问：${url}`));
  } catch (e) {
    console.error(`无法自动打开浏览器，请手动访问：${url}`);
  }
}

// 空闲自退（儿童场景：防家长忘了关，留孤儿进程）
setInterval(() => {
  if (Date.now() - lastActive > IDLE_TIMEOUT) gracefulExit();
}, 60 * 1000);

// 端口是 localStorage 身份的一部分；占用时明确报错，避免新端口看似丢数据。
function listen(port) {
  server.listen(port, '127.0.0.1', () => {
    fs.writeFileSync(path.join(ROOT, 'server.pid'), String(process.pid));
    console.log(`敲敲乐已启动： http://127.0.0.1:${port}`);
    openBrowser(`http://127.0.0.1:${port}`);
  });

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用。请使用已打开的 http://127.0.0.1:${port}，或关闭占用该端口的程序后重试；不会改用其他端口，以免本机进度看似丢失。`);
      process.exit(1);
    } else {
      console.error('无法启动服务器：', err.message);
      process.exit(1);
    }
  });
}

listen(BASE_PORT);
