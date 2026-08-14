#!/bin/bash
# 敲敲乐 Mac 启动脚本（双击运行）
cd "$(dirname "$0")"

# 优先使用 PATH 中的 node，回退到 managed node
NODE_BIN=$(command -v node 2>/dev/null)
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="/Users/hjuyam/.workbuddy/binaries/node/versions/22.22.2/bin/node"
fi

if [ ! -x "$NODE_BIN" ]; then
  echo "未找到 Node.js，请先安装 Node.js 18+。"
  echo "按回车键关闭..."
  read
  exit 1
fi

"$NODE_BIN" server.js
