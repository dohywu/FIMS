#!/bin/bash
# npm run dev로 실행된 Node 서버만 종료

PIDS=$(ps aux | grep "node" | grep "dev" | grep -v grep | awk '{print $2}')

if [ -z "$PIDS" ]; then
  echo "⚠ npm run dev로 실행된 서버가 없습니다."
else
  echo "🛑 다음 프로세스를 종료합니다: $PIDS"
  kill -9 $PIDS
  echo "✅ 종료 완료"
fi


# How to use:
# 1. Save this script as kill-dev.sh
# 2. Make it executable: chmod +x kill-dev.sh
# 3. Run it: ./kill-dev.sh
# Note: Use with caution, as it forcefully kills processes.