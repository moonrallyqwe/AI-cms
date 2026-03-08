#!/bin/bash
# AI-CMS文章迁移脚本 v4
# 支持认证的公司CMS

LOG_FILE="/home/openclaw/ai-cms/migration.log"
REPORT_FILE="/home/openclaw/ai-cms/migration-report.md"
API_CMS="http://a591977220.synology.me:8888"
API_AI="http://localhost:3001"
CMS_IMG_DIR="/home/openclaw/ai-cms/web/images"
COOKIE_FILE="/tmp/cms-login-cookies.txt"

echo "===== $(date) 开始迁移 =====" > $LOG_FILE
echo "# 迁移报告 - $(date)" > $REPORT_FILE
echo "" >> $REPORT_FILE

# 1. 登录CMS获取cookie
echo "1. 登录CMS..." >> $LOG_FILE
LOGIN_RESP=$(curl -s -c $COOKIE_FILE -L -X POST "$API_CMS/wp-login.php" \
  -d "log=openclaw&pwd=Admin@123&wp-submit=登录&redirect_to=$API_CMS/wp-admin/" 2>/dev/null)

# 检查是否登录成功
CHECK=$(curl -s -b $COOKIE_FILE "$API_CMS/wp-admin/" 2>/dev/null | grep -o "wp-admin" | head -1)
if [ -z "$CHECK" ]; then
    echo "登录CMS失败" >> $LOG_FILE
    exit 1
fi
echo "登录成功" >> $LOG_FILE

# 2. 获取公司CMS文章列表
echo "2. 获取CMS文章列表..." >> $LOG_FILE
POSTS=$(curl -s -b $COOKIE_FILE "$API_CMS/wp-json/wp/v2/posts?per_page=100" 2>/dev/null)

CMS_ARTICLES=$(echo "$POSTS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for p in data:
    print(f\"{p['id']}|{p['title']['rendered']}\")
" 2>/dev/null)

if [ -z "$CMS_ARTICLES" ]; then
    echo "获取文章列表失败" >> $LOG_FILE
    exit 1
fi

# 3. 获取AI知识库已有文章ID
echo "3. 获取AI知识库已有文章..." >> $LOG_FILE
AI_DOCS=$(curl -s "$API_AI/api/docs" 2>/dev/null)
AI_IDS=$(echo "$AI_DOCS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for d in data:
    print(d['id'])
" 2>/dev/null)

CMS_COUNT=$(echo "$CMS_ARTICLES" | wc -l)
AI_COUNT=$(echo "$AI_IDS" | wc -l)
echo "CMS文章数: $CMS_COUNT" >> $LOG_FILE
echo "AI已有文章数: $AI_COUNT" >> $REPORT_FILE

# 4. 确保图片目录存在
mkdir -p $CMS_IMG_DIR

# 5. 遍历CMS文章
MIGRATED=0
SKIPPED=0
FAILED=0
REPORT_CONTENT=""

for ARTICLE in $CMS_ARTICLES; do
    POST_ID=$(echo "$ARTICLE" | cut -d'|' -f1)
    TITLE=$(echo "$ARTICLE" | cut -d'|' -f2-)
    
    # 检查是否已迁移
    if echo "$AI_IDS" | grep -q "^$POST_ID$"; then
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    
    echo "--- 处理文章 $POST_ID: $TITLE ---" >> $LOG_FILE
    
    # 获取文章详情
    POST_DATA=$(curl -s -b $COOKIE_FILE "$API_CMS/wp-json/wp/v2/posts/$POST_ID" 2>/dev/null)
    
    CONTENT=$(echo "$POST_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['content']['rendered'])" 2>/dev/null)
    
    if [ -z "$CONTENT" ]; then
        echo "获取文章内容失败: $POST_ID" >> $LOG_FILE
        FAILED=$((FAILED + 1))
        REPORT_CONTENT="$REPORT_CONTENT\n- ❌ $TITLE (获取内容失败)"
        continue
    fi
    
    # 提取文章中的图片URL
    IMG_URLS=$(echo "$CONTENT" | grep -oE 'http://a591977220.synology.me:8888/wp-content/uploads/[^"<>]+\.(jpg|jpeg|png|gif)' | sort -u)
    
    IMG_COUNT=0
    for IMG_URL in $IMG_URLS; do
        IMG_NAME=$(basename "$IMG_URL")
        
        # 检查图片是否已存在
        if [ -f "$CMS_IMG_DIR/$IMG_NAME" ]; then
            IMG_COUNT=$((IMG_COUNT + 1))
            continue
        fi
        
        # 从公司CMS下载图片
        curl -s -o "$CMS_IMG_DIR/$IMG_NAME" "$IMG_URL" 2>/dev/null
        
        if [ -f "$CMS_IMG_DIR/$IMG_NAME" ]; then
            FILE_SIZE=$(stat -c%s "$CMS_IMG_DIR/$IMG_NAME" 2>/dev/null || echo 0)
            if [ "$FILE_SIZE" -gt 100 ]; then
                IMG_COUNT=$((IMG_COUNT + 1))
                echo "下载图片: $IMG_NAME ($FILE_SIZE bytes)" >> $LOG_FILE
            else
                rm -f "$CMS_IMG_DIR/$IMG_NAME"
            fi
        fi
    done
    echo "共 $IMG_COUNT 张图片" >> $LOG_FILE
    
    # 替换内容中的图片链接为AI-CMS链接
    NEW_CONTENT=$(echo "$CONTENT" | sed "s|http://a591977220.synology.me:8888/wp-content/uploads|http://192.168.31.120:8080/images|g")
    
    # 获取标签
    TAGS=$(echo "$POST_DATA" | python3 -c "
import json, sys
data = json.load(sys.stdin)
tags = data.get('tags', [])
print(','.join(map(str, tags)))
" 2>/dev/null)
    
    # 6. 创建到AI知识库
    RESULT=$(curl -s -X POST "$API_AI/api/docs" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"$POST_ID\",\"title\":\"$TITLE\",\"content\":\"$NEW_CONTENT\",\"tags\":[\"$TAGS\"],\"permissions\":[\"admin\",\"user\",\"ai\"]}" 2>/dev/null)
    
    echo "创建: $RESULT" >> $LOG_FILE
    
    # 7. 验证
    sleep 1
    VERIFY=$(curl -s "$API_AI/api/docs/$POST_ID" 2>/dev/null)
    VERIFY_TITLE=$(echo "$VERIFY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('title',''))" 2>/dev/null)
    
    if [ "$VERIFY_TITLE" = "$TITLE" ]; then
        echo "✅ 成功: $TITLE (含$IMG_COUNT张图片)" >> $LOG_FILE
        MIGRATED=$((MIGRATED + 1))
        REPORT_CONTENT="$REPORT_CONTENT\n- ✅ $TITLE (含$IMG_COUNT张图片)"
    else
        echo "❌ 失败: $TITLE" >> $LOG_FILE
        FAILED=$((FAILED + 1))
        REPORT_CONTENT="$REPORT_CONTENT\n- ❌ $TITLE"
    fi
    
    echo "====== 已处理 $((MIGRATED+SKIPPED+FAILED)) 篇，暂停 ======"
    
    # 只处理1篇测试
    break
done

# 8. 生成报告
echo "" >> $REPORT_FILE
echo "## 迁移结果" >> $REPORT_FILE
echo "- 迁移成功: $MIGRATED 篇" >> $REPORT_FILE
echo "- 跳过: $SKIPPED 篇" >> $REPORT_FILE
echo "- 失败: $FAILED 篇" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "## 详细清单" >> $REPORT_FILE
echo -e "$REPORT_CONTENT" >> $REPORT_FILE

cat $REPORT_FILE
echo "===== 完成 ====="

rm -f $COOKIE_FILE
