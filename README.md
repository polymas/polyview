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
- **活动数据源**: Polymarket Data API（无本地缓存）

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

如需自定义配置，可在 Vercel 项目设置中添加：

- `ACTIVITY_CONCURRENT_SEGMENTS`: `/api/activity` 并发分片数（默认 `6`，最大 `12`）
- `FILTER_CONDITION_IDS`: 服务端排除的 conditionId 列表（仅代理接口生效，可选）

## 使用说明

1. 在输入框中输入你的 Polymarket 钱包地址（0x 开头的地址）
2. 点击"查询"按钮获取交易记录
3. 查看统计数据、盈亏日历和详细的盈亏表格
4. 可以切换查看近7天或近30天的统计数据

## API 端点

- `GET /api/activity` - 获取用户活动记录（Vercel Node 后端并发拉取 Polymarket activity）
  - 参数: `user` (必需), `limit` (0 或 -1 表示全部), `offset`, `sort_by`, `sort_direction`, `use_cache`（传 `false` 时向后端请求强制刷新）, `days`, `range=month`
- `GET /api/health` - 健康检查

## 项目结构

```
polyview/
├── app/
│   ├── api/              # API Routes
│   │   ├── activity/     # 活动数据 API（并发拉取 Polymarket activity）
│   │   └── health/       # 健康检查 API
│   ├── components/       # React 组件
│   │   ├── PnLTable.tsx           # 盈亏表格组件
│   │   ├── PnLCalendar.tsx        # 盈亏日历组件
│   │   ├── TradingVolumeCalendar.tsx  # 交易额日历组件
│   │   ├── Statistics.tsx        # 统计信息组件
│   │   └── HoldingDurationChart.tsx   # 持仓时长分布图表
│   ├── services/         # 服务层
│   │   └── polymarketApi.ts      # 前端调用 /api/activity
│   ├── utils/            # 工具函数
│   │   └── pnlCalculator.ts      # 盈亏计算逻辑
│   ├── types.ts          # TypeScript 类型定义
│   ├── page.tsx          # 主页面
│   ├── layout.tsx        # 布局组件
│   └── globals.css       # 全局样式
├── lib/
│   └── polymarketApi.ts    # Polymarket 直连 API（脚本/后端用）
├── next.config.mjs       # Next.js 配置
├── vercel.json           # Vercel 部署配置
└── package.json
```

## 工作原理

1. **数据获取**: 前端调用本站 `/api/activity`，由 Vercel Node 后端按时间分片并发拉取 activity 后聚合去重
2. **数据计算**: 前端使用 `pnlCalculator` 计算盈亏、统计数据等
3. **数据展示**: 使用 React 组件和 Recharts 可视化展示数据

## 注意事项

- **数据源**: 活动数据由 Polymarket Data API 提供，本应用不缓存，每次查询由后端实时拉取
- **网络**: 部署环境需能访问 `https://data-api.polymarket.com`
- 若钱包地址无交易记录，会显示相应提示

## 开发

项目使用 Next.js App Router，支持：
- 服务端渲染 (SSR)
- API Routes
- 热模块替换 (HMR)
- TypeScript 类型检查

## License

MIT
