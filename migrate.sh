#!/bin/bash
# 迁移脚本 - 失败重试，记录错误
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

API_CMS="http://a591977220.synology.me:8888"
API_AI="http://localhost:3001"
IMG_DIR="/home/openclaw/ai-cms/web/images"
LOG=/home/openclaw/ai-cms/migrate.log
ERROR_LOG=/home/openclaw/ai-cms/migrate-errors.log
MAX_RETRIES=3

echo "=== $(date) ===" > $LOG

# 登录CMS
curl -s -c /tmp/c_cms.txt -L "$API_CMS/wp-login.php" -d "log=openclaw&pwd=Admin@123" > /dev/null 2>&1

# 获取文章列表
POSTS=$(curl -s -b /tmp/c_cms.txt "$API_CMS/wp-json/wp/v2/posts?per_page=20")
IDS=$(echo "$POSTS" | python3 -c "import json,sys;[print(p['id']) for p in json.load(sys.stdin)]" 2>/dev/null)

# 获取AI已有
AI_DOCS=$(cat /home/openclaw/ai-cms/data/docs.json)
AI_IDS=$(echo "$AI_DOCS" | python3 -c "import json,sys;[print(d['id']) for d in json.load(sys.stdin)]" 2>/dev/null)

echo "CMS: $(echo $IDS | wc -w) 篇, AI: $(echo $AI_IDS | wc -w) 篇" >> $LOG

# 遍历未迁移的文章
for id in $IDS; do
  # 跳过已存在的
  if echo "$AI_IDS" | grep -q "^$id$"; then
    continue
  fi
  
  echo "处理: $id" >> $LOG
  
  RETRY=0
  while [ $RETRY -lt $MAX_RETRIES ]; do
    RETRY=$((RETRY+1))
    echo "尝试 $RETRY/$MAX_RETRIES" >> $LOG
    
    # 获取文章
    DATA=$(curl -s -b /tmp/c_cms.txt "$API_CMS/wp-json/wp/v2/posts/$id")
    echo "$DATA" > /tmp/post_$id.json
    
    # 提取内容
    python3 << PYEOF > /tmp/mig_$id.json 2>> $LOG
import json
with open("/tmp/post_$id.json") as f:
    data = json.load(f)
title = data["title"]["rendered"]
content = data["content"]["rendered"]
if not content:
    print("ERROR: 内容为空")
    exit(1)
content = content[:15000]
content = content.replace("http://a591977220.synology.me:8888/wp-content/uploads", "http://192.168.31.120:8080/images")
new_doc = {
    "id": str(data["id"]),
    "title": title,
    "content": content,
    "tags": [],
    "permissions": ["admin", "user", "ai"],
    "files": [],
    "createdAt": data.get("date", "")[:10] + "T00:00:00.000Z"
}
with open("/home/openclaw/ai-cms/data/docs.json") as f:
    docs = json.load(f)
docs.append(new_doc)
with open("/home/openclaw/ai-cms/data/docs.json", "w") as f:
    json.dump(docs, f, ensure_ascii=False, indent=2)
print("OK:" + title[:30])
PYEOF
    
    # 检查结果
    if grep -q "ERROR" /tmp/mig_$id.json 2>/dev/null; then
        ERROR_MSG=$(cat /tmp/mig_$id.json)
        echo "错误: $ERROR_MSG" >> $LOG
        echo "$id: $ERROR_MSG" >> $ERROR_LOG
        break
    fi
    
    # 重启服务
    pkill -f "node server" 2>/dev/null
    cd /home/openclaw/ai-cms && node server.js > /dev/null 2>&1 &
    sleep 3
    
    # 验证
    VERIFY=$(curl -s "http://localhost:3001/api/docs/$id" 2>/dev/null)
    if echo "$VERIFY" | grep -q '"title"'; then
        # 获取实际标题对比
        VERIFY_TITLE=$(echo "$VERIFY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('title',''))" 2>/dev/null)
        if [ -n "$VERIFY_TITLE" ]; then
            echo "成功: $id - $VERIFY_TITLE" >> $LOG
            echo "✅ 迁移成功: $id - $VERIFY_TITLE"
            rm -f /tmp/post_$id.json /tmp/mig_$id.json
            exit 0
        fi
    fi
    
    echo "验证失败，重试..." >> $LOG
    # 删除刚添加的文章
    python3 << PYEOF
import json
with open("/home/openclaw/ai-cms/data/docs.json") as f:
    docs = json.load(f)
docs = [d for d in docs if d["id"] != "$id"]
with open("/home/openclaw/ai-cms/data/docs.json", "w") as f:
    json.dump(docs, f, ensure_ascii=False, indent=2)
PYEOF
    
    sleep 2
  done
  
  # 3次都失败
  if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "跳过: $id (已重试$MAX_RETRIES次)" >> $LOG
    echo "❌ 跳过: $id (重试$MAX_RETRIES次失败)"
    echo "$id: 3次重试失败" >> $ERROR_LOG
  fi
  
  # 只处理1篇
  break
done

rm -f /tmp/c_cms.txt /tmp/post_*.json /tmp/mig_*.json
echo "=== 完成 ===" >> $LOG
