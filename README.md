# Polymarket 交易分析工具

一个基于 Next.js 和 TypeScript 的 Polymarket 交易记录分析和可视化工具。

## 功能特性

- 📊 **交易记录获取**: 根据钱包地址获取 Polymarket 历史交易记录
- 💰 **盈亏分析**: 自动计算每个命题的盈亏情况
- 📅 **盈亏日历**: 可视化展示每日盈亏情况
- 📈 **统计数据**: 包括总投入、总盈亏、收益率等
- 🎯 **月化收益率**: 自动计算月化收益率（基于最大占用资金）

## 技术栈

- **前端框架**: Next.js 16 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **数据可视化**: Recharts
- **日期处理**: date-fns
- **HTTP 客户端**: Axios
- **数据库**: SQLite (better-sqlite3)

## 安装和运行

### 前置要求

- Node.js 18+
- npm 或 yarn

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

启动后访问：http://localhost:3000

### 构建生产版本

```bash
npm run build
```

### 启动生产服务器

```bash
npm start
```

## 部署到 Vercel

### 方式 1: 通过 Vercel CLI

1. 安装 Vercel CLI：
```bash
npm i -g vercel
```

2. 部署：
```bash
vercel
```

### 方式 2: 通过 GitHub

1. 将代码推送到 GitHub
2. 在 [Vercel](https://vercel.com) 中导入项目
3. Vercel 会自动检测 Next.js 并部署

### 环境变量

如果需要自定义配置，可以在 Vercel 项目设置中添加环境变量：

- `DB_FILE`: 数据库文件路径（默认：`/tmp/polymarket_cache.db`，Vercel 使用临时存储）
- `FILTER_CONDITION_IDS`: 用于排除活动数据的 conditionId 列表（可选，如果设置则排除匹配这些 conditionId 的活动记录）。支持多个 conditionId，使用逗号分隔，例如：`0x123...,0x456...,0x789...`

**注意**: Vercel 的 `/tmp` 目录是临时存储，重启后会丢失。如需持久化，建议使用：
- Vercel KV (Redis)
- Vercel Postgres
- 或其他外部数据库服务

## 使用说明

1. 在输入框中输入你的 Polymarket 钱包地址（0x 开头的地址）
2. 点击"查询"按钮获取交易记录
3. 查看统计数据、盈亏日历和详细的盈亏表格
4. 可以切换查看近7天或近30天的统计数据

## API 端点

项目提供以下 API 端点：

- `GET /api/activity` - 获取用户活动记录
  - 参数: `user` (必需), `limit`, `offset`, `sort_by`, `sort_direction`, `use_cache`
- `GET /api/health` - 健康检查
- `GET /api/cache/stats` - 查看缓存统计
- `DELETE /api/cache/clear` - 清除用户缓存

## 项目结构

```
polyview/
├── app/
│   ├── api/              # API Routes
│   │   ├── activity/     # 活动数据 API
│   │   ├── cache/        # 缓存管理 API
│   │   └── health/       # 健康检查 API
│   ├── components/       # React 组件
│   │   ├── PnLTable.tsx           # 盈亏表格组件
│   │   ├── PnLCalendar.tsx        # 盈亏日历组件
│   │   ├── TradingVolumeCalendar.tsx  # 交易额日历组件
│   │   ├── Statistics.tsx        # 统计信息组件
│   │   └── HoldingDurationChart.tsx   # 持仓时长分布图表
│   ├── services/         # 服务层
│   │   └── polymarketApi.ts      # Polymarket API 集成
│   ├── utils/            # 工具函数
│   │   └── pnlCalculator.ts      # 盈亏计算逻辑
│   ├── types.ts          # TypeScript 类型定义
│   ├── page.tsx          # 主页面
│   ├── layout.tsx        # 布局组件
│   └── globals.css       # 全局样式
├── lib/                  # 后端库
│   ├── cache.ts          # SQLite 缓存管理
│   └── polymarketApi.ts  # Polymarket API 调用逻辑
├── next.config.mjs       # Next.js 配置
├── vercel.json           # Vercel 部署配置
└── package.json
```

## 工作原理

1. **数据获取**: 前端调用 `/api/activity` 获取用户交易记录
2. **缓存机制**: 使用 SQLite 数据库缓存 API 响应，减少对 Polymarket API 的请求
3. **数据计算**: 前端使用 `pnlCalculator` 计算盈亏、统计数据等
4. **数据展示**: 使用 React 组件和 Recharts 可视化展示数据

## 注意事项

- **真实数据**: 本应用直接调用 Polymarket 的真实 API 获取交易数据
- **数据限制**: 
  - API 查询限制为最多 1000 条记录
  - 如果钱包地址没有交易记录，会显示相应提示
- **网络要求**: 需要能够访问 Polymarket 的 API 端点
- **缓存**: 数据会缓存在本地 SQLite 数据库中，提高查询速度

## 开发

项目使用 Next.js App Router，支持：
- 服务端渲染 (SSR)
- API Routes
- 热模块替换 (HMR)
- TypeScript 类型检查

## License

MIT
