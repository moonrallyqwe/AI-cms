# AI-CMS 知识库系统

> 面向AI的知识库管理系统，支持多格式文件存储、内容提取、语义搜索和RAG问答

## 功能特性

- ð **多格式文件管理** - 支持图片、视频、音频、文档、压缩包等格式
- ð **内容提取** - 自动提取文档文本内容
- ð§  **语义搜索** - 基于向量的智能搜索
- ð¤ **RAG问答** - 结合AI的知识问答系统
- ð¤ **用户认证** - 完整的登录注册机制

## 技术栈

- **后端**: Node.js + Fastify
- **前端**: HTML + JavaScript
- **存储**: 本地文件系统

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
npm start
```

服务启动后访问:
- 前端: http://localhost:8080
- API: http://localhost:3001

### 账号

- 管理员: admin / admin123
- 用户: user / user123

## 目录结构

```
ai-cms/
├── server.js          # 后端服务
├── package.json       # 依赖配置
├── web/               # 前端页面
│   ├── login.html
│   └── home.html
├── data/              # 数据存储（本地）
│   ├── docs.json      # 文档数据
│   └── users.json     # 用户数据
└── uploads/           # 上传文件（本地）
```

## API端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login | 用户登录 |
| POST | /api/register | 用户注册 |
| GET | /api/docs | 获取文档列表 |
| POST | /api/docs | 创建文档 |
| GET | /api/search | 搜索文档 |

## 注意事项

- data/、uploads/ 目录包含敏感数据，已排除在版本控制外
- 首次运行自动初始化数据文件

## License

MIT
