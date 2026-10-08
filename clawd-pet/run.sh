#!/usr/bin/env sh
# 编译并启动小 Clawd 桌宠（macOS / Linux）。加 --demo 用假数据预览。
set -e
cd "$(dirname "$0")"
mkdir -p out
javac -encoding UTF-8 -d out -sourcepath src src/clawd/ClawdPet.java
nohup java -cp out clawd.ClawdPet "$@" >/dev/null 2>&1 &
echo "Clawd 已启动，右键它可以退出。"
