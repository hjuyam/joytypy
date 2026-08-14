#!/usr/bin/env python3
# 敲敲乐 Python 启动脚本（备选，等价于 server.js 的静态托管 + /api/lessons）
import http.server, json, os, re, socketserver, sys, webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LESSONS_DIR = ROOT / "lessons"
PORT = 5173
LESSON_RE = re.compile(r'^[\u4e00-\u9fa5a-zA-Z0-9_.\-]+\.(txt|md)$', re.I)
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8',
        '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8'}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)
    def send_body(self, body, ctype='text/plain; charset=utf-8', code=200):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.end_headers()
        self.wfile.write(body.encode('utf-8') if isinstance(body, str) else body)
    def do_GET(self):
        from urllib.parse import unquote
        url = unquote(self.path.split('?')[0])
        if url == '/api/lessons':
            files = []
            if LESSONS_DIR.is_dir():
                for f in sorted(LESSONS_DIR.iterdir()):
                    if LESSON_RE.match(f.name):
                        txt = f.read_text(encoding='utf-8')
                        chars = len(re.findall(r'[\u4e00-\u9fa5]', txt))
                        files.append({'name': f.name, 'chars': chars})
            return self.send_body(json.dumps(files), 'application/json; charset=utf-8')
        if url.startswith('/api/lessons/'):
            name = url[len('/api/lessons/'):]
            if not LESSON_RE.match(name):
                return self.send_body('bad name', code=400)
            fp = (LESSONS_DIR / name).resolve()
            if not str(fp).startswith(str(LESSONS_DIR.resolve())):
                return self.send_body('forbidden', code=403)
            if not fp.is_file():
                return self.send_body('not found', code=404)
            return self.send_body(fp.read_text(encoding='utf-8'))
        rel = 'index.html' if url == '/' else url.lstrip('/')
        fp = (ROOT / rel).resolve()
        if not str(fp).startswith(str(ROOT.resolve())):
            return self.send_body('forbidden', code=403)
        if not fp.is_file():
            return self.send_body('404', code=404)
        ctype = MIME.get(fp.suffix, 'application/octet-stream')
        return self.send_body(fp.read_bytes(), ctype)

if __name__ == '__main__':
    with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
        print(f'敲敲乐已启动： http://127.0.0.1:{PORT}')
        webbrowser.open(f'http://127.0.0.1:{PORT}')
        httpd.serve_forever()
