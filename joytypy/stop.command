#!/bin/bash
# 敲敲乐 Mac 停止脚本（双击运行）
cd "$(dirname "$0")"
if [ -f server.pid ]; then
  kill "$(cat server.pid)" 2>/dev/null
  rm -f server.pid
  echo "敲敲乐已停止。"
else
  echo "未发现运行中的敲敲乐。"
fi
echo "按回车键关闭..."
read
