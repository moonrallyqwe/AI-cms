/**
 * AI-CMS v2.0
 * 面向AI的知识库系统
 * 支持：多格式文件存储、内容提取、语义搜索、RAG问答
 */

const fastify = require("fastify")({ logger: true });
const cors = require("@fastify/cors");
const cookie = require("@fastify/cookie");
const multer = require("@fastify/multipart");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ==================== 配置 ====================
const CONFIG = {
  DATA_DIR: path.join(__dirname, "data"),
  FILES_DIR: path.join(__dirname, "data", "files"),
  VECTORS_DIR: path.join(__dirname, "data", "vectors"),
  TEMP_DIR: path.join(__dirname, "data", "temp"),
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  CACHE_TTL: 300, // 5分钟缓存
  ALLOWED_EXTENSIONS: {
    // 图片
    'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image', 'webp': 'image', 'svg': 'image', 'bmp': 'image',
    // 视频
    'mp4': 'video', 'webm': 'video', 'avi': 'video', 'mov': 'video', 'mkv': 'video',
    // 音频
    'mp3': 'audio', 'wav': 'audio', 'ogg': 'audio', 'flac': 'audio', 'm4a': 'audio',
    // 文档
    'pdf': 'document', 'doc': 'document', 'docx': 'document', 'xls': 'document', 'xlsx': 'document', 
    'ppt': 'document', 'pptx': 'document', 'txt': 'document', 'md': 'document', 'csv': 'document',
    // 压缩包
    'zip': 'archive', 'rar': 'archive', '7z': 'archive', 'tar': 'archive', 'gz': 'archive',
    // 其他
    'json': 'data', 'xml': 'data', 'html': 'data', 'css': 'data', 'js': 'data'
  }
};

// ==================== 目录初始化 ====================
[CONFIG.DATA_DIR, CONFIG.FILES_DIR, CONFIG.VECTORS_DIR, CONFIG.TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==================== 数据文件初始化 ====================
const initDataFile = (filename, defaultData) => {
  const filePath = path.join(CONFIG.DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
  return filePath;
};

const usersFile = initDataFile("users.json", [
  { id: "1", username: "admin", password: "admin123", role: "admin" },
  { id: "2", username: "user", password: "user123", role: "user" },
  { id: "3", username: "openclaw", password: "openclaw", role: "ai" }
]);

const docsFile = initDataFile("docs.json", [
  { 
    id: "1", 
    title: "欢迎使用AI知识库", 
    content: "# 欢迎使用AI知识库\n\n这是一个面向AI的智能知识库系统。", 
    tags: ["首页"], 
    permissions: ["admin", "user", "ai"], 
    createdAt: new Date().toISOString() 
  }
]);

// ==================== 简单内存缓存 ====================
class SimpleCache {
  constructor(ttl = 300) {
    this.cache = new Map();
    this.ttl = ttl * 1000;
  }
  
  set(key, value) {
    this.cache.set(key, { value, time: Date.now() });
  }
  
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.time > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }
  
  delete(key) {
    this.cache.delete(key);
  }
  
  clear() {
    this.cache.clear();
  }
}

const cache = new SimpleCache(CONFIG.CACHE_TTL);

// ==================== 插件系统 ====================
const plugins = {
  // 内容提取器
  extractors: {
    // 图片元数据提取
    image: async (filePath, metadata) => {
      return {
        type: 'image',
        size: fs.statSync(filePath).size,
        name: metadata.originalName,
        extracted: `图片文件: ${metadata.originalName}, 大小: ${Math.round(metadata.size/1024)}KB`
      };
    },
    // 视频元数据提取
    video: async (filePath, metadata) => {
      return {
        type: 'video',
        size: fs.statSync(filePath).size,
        name: metadata.originalName,
        extracted: `视频文件: ${metadata.originalName}, 大小: ${Math.round(metadata.size/1024/1024)}MB`
      };
    },
    // 音频元数据提取
    audio: async (filePath, metadata) => {
      return {
        type: 'audio',
        size: fs.statSync(filePath).size,
        name: metadata.originalName,
        extracted: `音频文件: ${metadata.originalName}, 大小: ${Math.round(metadata.size/1024)}KB`
      };
    },
    // 文档内容提取
    document: async (filePath, metadata) => {
      const ext = metadata.extension.toLowerCase();
      let extracted = '';
      
      try {
        if (ext === 'txt' || ext === 'md' || ext === 'csv' || ext === 'json' || ext === 'xml' || ext === 'html' || ext === 'css' || ext === 'js') {
          extracted = fs.readFileSync(filePath, 'utf-8').substring(0, 5000);
        } else if (ext === 'pdf') {
          // 简单PDF处理（实际生产需要pdf-parse）
          extracted = `[PDF文档] ${metadata.originalName} - 需要pdf-parse库进行全文提取`;
        } else {
          extracted = `[文档] ${metadata.originalName} - 支持格式: doc, docx, xls, xlsx, ppt, pptx, pdf, txt, md`;
        }
      } catch (e) {
        extracted = `[文档] ${metadata.originalName} - 无法提取内容`;
      }
      
      return {
        type: 'document',
        size: fs.statSync(filePath).size,
        name: metadata.originalName,
        extracted: extracted.substring(0, 10000) // 限制提取内容长度
      };
    },
    // 压缩包内容列表
    archive: async (filePath, metadata) => {
      return {
        type: 'archive',
        size: fs.statSync(filePath).size,
        name: metadata.originalName,
        extracted: `[压缩包] ${metadata.originalName} - 内容需解压查看`
      };
    },
    // 默认处理
    default: async (filePath, metadata) => {
      return {
        type: 'unknown',
        size: fs.statSync(filePath).size,
        name: metadata.originalName,
        extracted: `文件: ${metadata.originalName}`
      };
    }
  }
};

// ==================== Fastify插件 ====================
fastify.register(cors, { origin: true, credentials: true });
fastify.register(cookie);
fastify.register(multer, { 
  limits: { fileSize: CONFIG.MAX_FILE_SIZE },
  attachFileToBody: true
});

// ==================== 安全中间件 ====================
const sanitize = (input) => {
  if (typeof input !== 'string') return input;
  return input.replace(/[<>'"]/g, '');
};

const sanitizeObject = (obj) => {
  const result = {};
  for (const key in obj) {
    result[key] = sanitize(obj[key]);
  }
  return result;
};

// ==================== 认证中间件 ====================
async function authenticate(request, reply) {
  const token = request.cookies.token;
  if (!token) {
    reply.code(401).send({ error: "未登录" });
    return;
  }
  const users = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
  const user = users.find(u => u.id === token);
  if (!user) {
    reply.code(401).send({ error: "未登录" });
    return;
  }
  request.user = user;
}

// ==================== 认证API ====================

// 登录
fastify.post("/api/auth/login", async (request, reply) => {
  const { username, password } = request.body;
  const users = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return { error: "Invalid credentials" };
  }
  reply.setCookie("token", user.id, { path: "/", httpOnly: true });
  return { success: true, user: { id: user.id, username: user.username, role: user.role } };
});

// 登出
fastify.post("/api/auth/logout", async (request, reply) => {
  reply.clearCookie("token", { path: "/" });
  return { success: true };
});

// 获取当前用户
fastify.get("/api/auth/me", { preHandler: authenticate }, async (request, reply) => {
  return { user: request.user };
});

// ==================== 文档API ====================

// 获取文档列表（公开）
fastify.get("/api/docs", async (request, reply) => {
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  return docs.map(d => ({ 
    id: d.id, 
    title: d.title, 
    tags: d.tags, 
    permissions: d.permissions,
    hasFiles: d.files ? d.files.length > 0 : false
  }));
});

// 获取单个文档
fastify.get("/api/docs/:id", async (request, reply) => {
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const doc = docs.find(d => d.id === request.params.id);
  if (!doc) {
    reply.code(404).send({ error: "Document not found" });
    return;
  }
  // 公开访问，无需权限检查
  return doc;
});

// 创建文档
fastify.post("/api/docs", { preHandler: authenticate }, async (request, reply) => {
  const { title, content, tags, permissions } = request.body;
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  
  const newDoc = {
    id: String(Date.now()),
    title: sanitize(title),
    content: content, // 内容不净化，保留格式
    tags: (tags || []).map(sanitize),
    permissions: permissions || ["admin"],
    files: [],
    createdAt: new Date().toISOString()
  };
  
  docs.push(newDoc);
  fs.writeFileSync(docsFile, JSON.stringify(docs, null, 2));
  cache.clear();
  
  return newDoc;
});

// 更新文档
fastify.put("/api/docs/:id", { preHandler: authenticate }, async (request, reply) => {
  const { title, content, tags, permissions } = request.body;
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const index = docs.findIndex(d => d.id === request.params.id);
  
  if (index === -1) {
    return { error: "Document not found" };
  }
  
  docs[index] = {
    ...docs[index],
    title: title ? sanitize(title) : docs[index].title,
    content: content || docs[index].content,
    tags: tags ? tags.map(sanitize) : docs[index].tags,
    permissions: permissions || docs[index].permissions,
    updatedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(docsFile, JSON.stringify(docs, null, 2));
  cache.delete(`doc:${request.params.id}`);
  
  return docs[index];
});

// 删除文档
fastify.delete("/api/docs/:id", { preHandler: authenticate }, async (request, reply) => {
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const index = docs.findIndex(d => d.id === request.params.id);
  
  if (index === -1) {
    return { error: "Document not found" };
  }
  
  // 删除关联的文件
  const doc = docs[index];
  if (doc.files) {
    doc.files.forEach(f => {
      const filePath = path.join(CONFIG.FILES_DIR, f.id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  }
  
  docs.splice(index, 1);
  fs.writeFileSync(docsFile, JSON.stringify(docs, null, 2));
  cache.clear();
  
  return { success: true };
});

// ==================== 文件上传API ====================

// 上传文件到文档
fastify.post("/api/docs/:id/files", { preHandler: authenticate }, async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return { error: "No file uploaded" };
  }
  
  const ext = path.extname(data.filename).slice(1).toLowerCase();
  const fileType = CONFIG.ALLOWED_EXTENSIONS[ext] || 'unknown';
  
  if (fileType === 'unknown') {
    return { error: "File type not allowed" };
  }
  
  const fileId = crypto.randomUUID();
  const filePath = path.join(CONFIG.FILES_DIR, `${fileId}.${ext}`);
  
  // 保存文件
  const buffer = await data.toBuffer();
  fs.writeFileSync(filePath, buffer);
  
  // 元数据
  const metadata = {
    id: fileId,
    originalName: sanitize(data.filename),
    extension: ext,
    type: fileType,
    size: buffer.length,
    path: `/api/files/${fileId}.${ext}`,
    uploadedAt: new Date().toISOString()
  };
  
  // 提取内容
  try {
    const extractor = plugins.extractors[fileType] || plugins.extractors.default;
    metadata.extracted = await extractor(filePath, metadata);
  } catch (e) {
    metadata.extracted = { error: e.message };
  }
  
  // 更新文档
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const doc = docs.find(d => d.id === request.params.id);
  
  if (!doc) {
    fs.unlinkSync(filePath); // 删除已上传的文件
    return { error: "Document not found" };
  }
  
  if (!doc.files) doc.files = [];
  doc.files.push(metadata);
  
  fs.writeFileSync(docsFile, JSON.stringify(docs, null, 2));
  cache.delete(`doc:${request.params.id}`);
  
  return metadata;
});

// 获取文件
fastify.get("/api/files/:filename", async (request, reply) => {
  const filename = sanitize(request.params.filename);
  const filePath = path.join(CONFIG.FILES_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    reply.code(404).send({ error: "File not found" });
    return;
  }
  
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mimeTypes = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
    'mp4': 'video/mp4', 'webm': 'video/webm',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'txt': 'text/plain', 'md': 'text/markdown',
    'json': 'application/json', 'xml': 'application/xml',
    'html': 'text/html', 'css': 'text/css', 'js': 'application/javascript'
  };
  
  reply.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  return fs.createReadStream(filePath);
});

// 删除文件
fastify.delete("/api/docs/:docId/files/:fileId", { preHandler: authenticate }, async (request, reply) => {
  const { docId, fileId } = request.params;
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const doc = docs.find(d => d.id === docId);
  
  if (!doc || !doc.files) {
    return { error: "Document or file not found" };
  }
  
  const fileIndex = doc.files.findIndex(f => f.id === fileId);
  if (fileIndex === -1) {
    return { error: "File not found" };
  }
  
  const file = doc.files[fileIndex];
  const ext = file.extension;
  const filePath = path.join(CONFIG.FILES_DIR, `${fileId}.${ext}`);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  doc.files.splice(fileIndex, 1);
  fs.writeFileSync(docsFile, JSON.stringify(docs, null, 2));
  cache.delete(`doc:${docId}`);
  
  return { success: true };
});

// ==================== 搜索API ====================

// 关键词搜索
fastify.post("/api/search", { preHandler: authenticate }, async (request, reply) => {
  const { query, type } = request.body;
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const userRole = request.user.role;
  
  const filtered = docs.filter(doc => 
    doc.permissions.includes(userRole) || doc.permissions.includes("role:" + userRole)
  );
  
  const q = query.toLowerCase();
  let results = filtered.filter(doc => {
    const matchTitle = doc.title.toLowerCase().includes(q);
    const matchContent = doc.content.toLowerCase().includes(q);
    const matchTags = doc.tags.some(t => t.toLowerCase().includes(q));
    const matchFiles = doc.files && doc.files.some(f => 
      f.originalName.toLowerCase().includes(q) ||
      (f.extracted && f.extracted.toString().toLowerCase().includes(q))
    );
    return matchTitle || matchContent || matchTags || matchFiles;
  });
  
  // 文件类型过滤
  if (type) {
    results = results.filter(doc => 
      doc.files && doc.files.some(f => f.type === type)
    );
  }
  
  return results.map(d => ({ 
    id: d.id, 
    title: d.title, 
    snippet: d.content.substring(0, 150) + "...",
    tags: d.tags,
    hasFiles: d.files ? d.files.length > 0 : false
  }));
});

// 高级搜索
fastify.post("/api/search/advanced", { preHandler: authenticate }, async (request, reply) => {
  const { query, tags, type, dateFrom, dateTo } = request.body;
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const userRole = request.user.role;
  
  let results = docs.filter(doc => 
    doc.permissions.includes(userRole) || doc.permissions.includes("role:" + userRole)
  );
  
  // 关键词
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(doc => 
      doc.title.toLowerCase().includes(q) ||
      doc.content.toLowerCase().includes(q) ||
      doc.tags.some(t => t.toLowerCase().includes(q))
    );
  }
  
  // 标签
  if (tags && tags.length > 0) {
    results = results.filter(doc => 
      tags.some(t => doc.tags.includes(t))
    );
  }
  
  // 文件类型
  if (type) {
    results = results.filter(doc => 
      doc.files && doc.files.some(f => f.type === type)
    );
  }
  
  // 日期范围
  if (dateFrom) {
    results = results.filter(doc => new Date(doc.createdAt) >= new Date(dateFrom));
  }
  if (dateTo) {
    results = results.filter(doc => new Date(doc.createdAt) <= new Date(dateTo));
  }
  
  return results;
});

// 获取所有标签
fastify.get("/api/tags", { preHandler: authenticate }, async (request, reply) => {
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const tags = new Set();
  docs.forEach(doc => doc.tags.forEach(tag => tags.add(tag)));
  return Array.from(tags).sort();
});

// 获取文件类型统计
fastify.get("/api/stats/file-types", { preHandler: authenticate }, async (request, reply) => {
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const stats = {};
  
  docs.forEach(doc => {
    if (doc.files) {
      doc.files.forEach(f => {
        stats[f.type] = (stats[f.type] || 0) + 1;
      });
    }
  });
  
  return stats;
});

// ==================== AI接口 ====================

// 自然语言创建文档
fastify.post("/api/ai/create", { preHandler: authenticate }, async (request, reply) => {
  const { prompt, title } = request.body;
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  
  // 智能提取
  let docTitle = title || prompt.split('\n')[0].substring(0, 50);
  let docContent = prompt;
  let docTags = [];
  
  // 简单关键词提取作为标签
  const keywords = ['运维', '技术', '产品', '安全', '网络', '服务器', '数据库', '备份', '容灾', '巡检', '防火墙'];
  keywords.forEach(k => {
    if (prompt.includes(k)) docTags.push(k);
  });
  
  const newDoc = {
    id: String(Date.now()),
    title: sanitize(docTitle),
    content: docContent,
    tags: docTags,
    permissions: ["admin", "user", "ai"],
    source: "ai-generated",
    createdAt: new Date().toISOString()
  };
  
  docs.push(newDoc);
  fs.writeFileSync(docsFile, JSON.stringify(docs, null, 2));
  cache.clear();
  
  return { success: true, doc: newDoc };
});

// 语义相似文档（简化版 - 实际需要向量库）
fastify.get("/api/ai/related/:id", { preHandler: authenticate }, async (request, reply) => {
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const doc = docs.find(d => d.id === request.params.id);
  
  if (!doc) {
    return { error: "Document not found" };
  }
  
  // 基于标签的简单相似度计算
  const docTags = new Set(doc.tags);
  const userRole = request.user.role;
  
  const related = docs
    .filter(d => d.id !== doc.id && (d.permissions.includes(userRole) || d.permissions.includes("role:" + userRole)))
    .map(d => ({
      id: d.id,
      title: d.title,
      similarity: d.tags.filter(t => docTags.has(t)).length
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
  
  return related;
});

// RAG问答（基础版）
fastify.post("/api/ai/rag", { preHandler: authenticate }, async (request, reply) => {
  const { question, context } = request.body;
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const userRole = request.user.role;
  
  // 简单关键词匹配（生产环境需要向量搜索）
  const q = question.toLowerCase();
  const relevantDocs = docs
    .filter(doc => doc.permissions.includes(userRole) || doc.permissions.includes("role:" + userRole))
    .filter(doc => 
      doc.title.toLowerCase().includes(q) ||
      doc.content.toLowerCase().includes(q) ||
      doc.tags.some(t => q.includes(t.toLowerCase()))
    )
    .slice(0, 3);
  
  if (relevantDocs.length === 0) {
    return { 
      answer: "抱歉，我在知识库中没有找到与您问题相关的内容。",
      sources: []
    };
  }
  
  // 构建上下文
  let contextText = relevantDocs.map(d => `【${d.title}】\n${d.content.substring(0, 1000)}`).join('\n\n');
  
  // 生成答案（这里简化处理，实际需要调用LLM）
  const answer = `根据知识库中的信息：\n\n${relevantDocs[0].content.substring(0, 500)}...\n\n如需了解更多详情，请查看完整文档。`;
  
  const result = { answer };
  
  if (context) {
    result.sources = relevantDocs.map(d => ({
      id: d.id,
      title: d.title,
      snippet: d.content.substring(0, 200)
    }));
  }
  
  return result;
});

// 内容摘要
fastify.post("/api/ai/summarize", { preHandler: authenticate }, async (request, reply) => {
  const { content, maxLength } = request.body;
  
  // 简单提取摘要（首段 + 关键句）
  const sentences = content.split(/[。！？\n]/).filter(s => s.trim());
  let summary = sentences.slice(0, 3).join('。');
  
  if (maxLength && summary.length > maxLength) {
    summary = summary.substring(0, maxLength) + '...';
  }
  
  return { summary: summary + '。' };
});

// ==================== 管理API ====================

// 获取系统信息
fastify.get("/api/admin/stats", { preHandler: authenticate }, async (request, reply) => {
  const docs = JSON.parse(fs.readFileSync(docsFile, "utf-8"));
  const users = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
  
  // 统计文件
  let totalFiles = 0;
  let totalFileSize = 0;
  docs.forEach(doc => {
    if (doc.files) {
      doc.files.forEach(f => {
        totalFiles++;
        totalFileSize += f.size || 0;
      });
    }
  });
  
  return {
    docs: docs.length,
    users: users.length,
    files: totalFiles,
    storage: totalFileSize,
    uptime: process.uptime()
  };
});

// ==================== 启动服务器 ====================
fastify.listen({ port: 3001, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log("AI-CMS v2.0 running on http://0.0.0.0:3001");
  console.log("Features:");
  console.log("  - Multi-format file support");
  console.log("  - Content extraction");
  console.log("  - AI-friendly APIs");
  console.log("  - RAG问答支持");
});
