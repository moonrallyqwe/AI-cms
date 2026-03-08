#!/bin/bash
# 迁移脚本 - 修复JSON转义
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

API_CMS="http://a591977220.synology.me:8888"
API_AI="http://localhost:3001"
LOG=/home/openclaw/ai-cms/migrate.log

echo "=== 开始迁移 $(date) ===" > $LOG

# 登录CMS
curl -s -c /tmp/c.txt -L "$API_CMS/wp-login.php" -d "log=openclaw&pwd=Admin@123" > /dev/null

# 获取文章列表
POSTS=$(curl -s -b /tmp/c.txt "$API_CMS/wp-json/wp/v2/posts?per_page=20")
IDS=$(echo "$POSTS" | python3 -c "import json,sys;[print(p['id']) for p in json.load(sys.stdin)]" 2>/dev/null)

# AI已有
AI_IDS=$(curl -s "$API_AI/api/docs" | python3 -c "import json,sys;[print(d['id']) for d in json.load(sys.stdin)]" 2>/dev/null)

echo "CMS: $(echo $IDS | wc -w) 篇, AI已有: $(echo $AI_IDS | wc -w) 篇" >> $LOG

for id in $IDS; do
  # 跳过已存在的
  if echo "$AI_IDS" | grep -q "^$id$"; then
    echo "跳过已存在: $id" >> $LOG
    continue
  fi
  
  # 获取文章内容
  DATA=$(curl -s -b /tmp/c.txt "$API_CMS/wp-json/wp/v2/posts/$id")
  TITLE=$(echo "$DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['title']['rendered'])" 2>/dev/null)
  CONTENT=$(echo "$DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['content']['rendered'])" 2>/dev/null)
  
  if [ -z "$TITLE" ]; then
    echo "获取失败: $id" >> $LOG
    continue
  fi
  
  # 清理特殊字符
  TITLE=$(echo "$TITLE" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" 2>/dev/null | tr -d '"')
  CONTENT=$(echo "$CONTENT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" 2>/dev/null)
  
  echo "处理: $id - $TITLE" >> $LOG
  
  # 下载图片
  mkdir -p /home/openclaw/ai-cms/web/images
  IMGS=$(echo "$CONTENT" | grep -oE "http://a591977220.synology.me:8888/wp-content/uploads/[^<>]+\.(jpg|jpeg|png|gif)" | sort -u)
  for url in $IMGS; do
    name=$(basename "$url")
    if [ ! -f "/home/openclaw/ai-cms/web/images/$name" ]; then
      curl -s -o "/home/openclaw/ai-cms/web/images/$name" "$url"
    fi
  done
  
  # 替换图片链接
  CONTENT=$(echo "$CONTENT" | sed "s|http://a591977220.synology.me:8888/wp-content/uploads|http://192.168.31.120:8080/images|g")
  
  # 用Python创建JSON
  python3 << PYEOF > /tmp/post.json
import json, sys
data = {
    "id": "$id",
    "title": """$TITLE""",
    "content": """$CONTENT""",
    "permissions": ["admin", "user", "ai"]
}
print(json.dumps(data, ensure_ascii=False))
PYEOF
  
  # 迁移文章
  RESULT=$(curl -s -X POST "$API_AI/api/docs" -H "Content-Type: application/json" -d @/tmp/post.json)
  echo "结果: $RESULT" >> $LOG
  
  echo "完成: $id" >> $LOG
  
  # 只迁移1篇测试
  break
done

rm -f /tmp/c.txt /tmp/post.json
echo "=== 完成 ===" >> $LOG
cat $LOG
