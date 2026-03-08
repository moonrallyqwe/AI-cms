#!/bin/bash
# 简化版迁移脚本
LOG="/home/openclaw/ai-cms/mig.log"
API_CMS="http://a591977220.synology.me:8888"
API_AI="http://localhost:3001"
IMG_DIR="/home/openclaw/ai-cms/web/images"

echo "===== $(date) =====" > $LOG
mkdir -p $IMG_DIR

# 登录获取cookie
echo "1. 登录..." >> $LOG
curl -s -c /tmp/c.txt -L "$API_CMS/wp-login.php" -d "log=openclaw&pwd=Admin@123" > /dev/null

# 获取CMS文章
echo "2. 获取文章..." >> $LOG
POSTS=$(curl -s -b /tmp/c.txt "$API_CMS/wp-json/wp/v2/posts?per_page=50")
IDS=$(echo "$POSTS" | python3 -c "import json,sys;[print(p['id']) for p in json.load(sys.stdin)]" 2>/dev/null)

# 获取AI已有
AI_IDS=$(curl -s "$API_AI/api/docs" | python3 -c "import json,sys;[print(d['id']) for d in json.load(sys.stdin)]" 2>/dev/null)

echo "CMS: $(echo $IDS | wc -w), AI: $(echo $AI_IDS | wc -w)" >> $LOG

for id in $IDS; do
  if echo "$AI_IDS" | grep -q "^$id$"; then
    echo "跳过 $id" >> $LOG
    continue
  fi
  
  # 获取内容
  DATA=$(curl -s -b /tmp/c.txt "$API_CMS/wp-json/wp/v2/posts/$id")
  TITLE=$(echo "$DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['title']['rendered'])" 2>/dev/null)
  CONTENT=$(echo "$DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['content']['rendered'])" 2>/dev/null)
  
  if [ -z "$TITLE" ]; then
    echo "获取失败: $id" >> $LOG
    continue
  fi
  
  echo "处理: $id - $TITLE" >> $LOG
  
  # 下载图片
  IMGS=$(echo "$CONTENT" | grep -oE "http://a591977220.synology.me:8888/wp-content/uploads/[^<>]+\.(jpg|jpeg|png|gif)" | sort -u)
  IMG_C=0
  for url in $IMGS; do
    name=$(basename "$url")
    if [ ! -f "$IMG_DIR/$name" ]; then
      curl -s -o "$IMG_DIR/$name" "$url"
      [ -f "$IMG_DIR/$name" ] && IMG_C=$((IMG_C+1))
    fi
  done
  echo "下载图片: $IMG_C 张" >> $LOG
  
  # 替换链接
  CONTENT=$(echo "$CONTENT" | sed "s|http://a591977220.synology.me:8888/wp-content/uploads|http://192.168.31.120:8080/images|g")
  
  # 迁移
  curl -s -X POST "$API_AI/api/docs" -H "Content-Type: application/json" -d "{\"id\":\"$id\",\"title\":\"$TITLE\",\"content\":\"$CONTENT\",\"permissions\":[\"admin\",\"user\",\"ai\"]}" >> $LOG
  
  echo "完成: $id - $TITLE" >> $LOG
  break
done

rm -f /tmp/c.txt
echo "===== 完成 =====" >> $LOG
cat $LOG
