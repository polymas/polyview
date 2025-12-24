# Polymarket 交易分析工具

一个基于 React 和 TypeScript 的 Polymarket 交易记录分析和可视化工具。

## 功能特性

- 📊 **交易记录获取**: 根据钱包地址获取 Polymarket 历史交易记录
- 💰 **盈亏分析**: 自动计算每个命题的盈亏情况
- 📅 **盈亏日历**: 可视化展示每日盈亏情况
- 📈 **统计数据**: 包括总投入、总盈亏、收益率等
- 🎯 **年化收益率**: 自动计算年化收益率

## 技术栈

- React 18
- TypeScript
- Vite
- Tailwind CSS
- date-fns
- Axios

## 安装和运行

### 前置要求

- Python 3.8+
- Node.js 16+
- npm 或 yarn

### 安装依赖

**Python依赖：**
```bash
pip install -r requirements.txt
```

**前端依赖：**
```bash
npm install
```

### 启动服务

#### 方式 1: 自动重启脚本（推荐，适合生产环境）

使用自动重启脚本，服务崩溃后会自动重启：

```bash
# 前台运行（可以看到日志）
python auto_restart.py

# 后台运行（daemon模式）
python auto_restart.py --daemon

# 停止服务
python auto_restart.py --stop

# 查看服务状态
python auto_restart.py --status
```

脚本功能：
- ✅ 自动监控前后端服务
- ✅ 服务崩溃后自动重启
- ✅ 支持后台运行（daemon模式）
- ✅ 重启频率限制（防止频繁重启）
- ✅ 日志记录到 `auto_restart.log`
- ✅ PID文件管理（`.auto_restart.pid`）

#### 方式 2: 统一启动脚本（适合开发环境）

使用统一启动脚本同时启动前后端：

```bash
python start.py
```

或直接运行：

```bash
./start.py
```

脚本会自动：
- ✅ 检查依赖是否安装
- ✅ 启动后端服务（FastAPI，端口8002）
- ✅ 启动前端服务（Vite，端口8001）
- ✅ 显示服务日志
- ✅ 按 Ctrl+C 优雅关闭所有服务

#### 方式 3: 分别启动

**启动后端：**
```bash
python activity.py
```

**启动前端：**
```bash
npm run dev
```

### 服务地址

#### 本地访问

启动成功后访问：
- **统一访问（推荐）**: http://localhost:8001
  - 前端应用和API都通过此端口访问
  - API请求（`/api/*`）会自动代理到后端（`http://localhost:8002`）
  - 无需处理跨域问题

**独立访问：**
- **前端应用**: http://localhost:8001
- **后端API**: http://localhost:8002
- **API文档（Swagger UI）**: http://localhost:8002/docs
- **API文档（ReDoc）**: http://localhost:8002/redoc

#### 公网访问

服务默认监听 `0.0.0.0`，支持公网访问。

**方式1：使用环境变量配置（推荐）**

创建 `.env` 文件（参考 `.env.example`）：
```bash
# 前端配置
VITE_PORT=8001
VITE_API_TARGET=http://your-server-ip:8002

# 后端配置
HOST=0.0.0.0
BACKEND_PORT=8002
FRONTEND_PORT=8001
API_TARGET=http://your-server-ip:8002
```

然后启动：
```bash
python start.py
```

**方式2：直接设置环境变量**

```bash
# Linux/Mac
export HOST=0.0.0.0
export BACKEND_PORT=8002
export FRONTEND_PORT=8001
export VITE_API_TARGET=http://your-server-ip:8002
python start.py

# Windows
set HOST=0.0.0.0
set BACKEND_PORT=8002
set FRONTEND_PORT=8001
set VITE_API_TARGET=http://your-server-ip:8002
python start.py
```

**方式3：前后端分离部署**

如果前后端部署在不同服务器：

1. **前端服务器**：创建 `.env` 文件
   ```
   VITE_API_BASE_URL=http://your-backend-server-ip:8002
   ```

2. **后端服务器**：直接启动
   ```bash
   python activity.py
   ```

访问地址：
- 前端：`http://your-frontend-server-ip:8001`
- 后端：`http://your-backend-server-ip:8002`

**注意事项：**
- 确保防火墙开放相应端口（8001和8002）
- 如果使用云服务器，确保安全组规则允许相应端口访问
- 生产环境建议使用Nginx反向代理和HTTPS

### 工作原理

- Vite开发服务器配置了代理，将 `/api/*` 请求转发到后端 `http://localhost:8002`
- 前端代码使用相对路径 `/api` 访问后端API
- 这样前后端看起来像同一个服务，避免跨域问题

### 构建生产版本

```bash
npm run build
```

## 使用说明

1. 在输入框中输入你的 Polymarket 钱包地址（0x 开头的地址）
2. 点击"查询"按钮获取交易记录
3. 查看统计数据、盈亏日历和详细的盈亏表格

## 注意事项

- **真实数据**: 本应用直接调用 Polymarket 的真实 API 获取交易数据
- **API 端点**: 
  - 优先使用 The Graph 的 Polymarket 子图（公共端点，无需 API key）
  - 备用方案使用 Polymarket CLOB API
- **数据限制**: 
  - The Graph 查询限制为最多 1000 条记录
  - 如果钱包地址没有交易记录，会显示相应提示
- **网络要求**: 需要能够访问 The Graph 和 Polymarket 的 API 端点

## 项目结构

```
polyview/
├── src/
│   ├── components/      # React 组件
│   │   ├── PnLTable.tsx      # 盈亏表格组件
│   │   ├── PnLCalendar.tsx   # 盈亏日历组件
│   │   └── Statistics.tsx    # 统计信息组件
│   ├── services/        # API 服务
│   │   └── polymarketApi.ts  # Polymarket API 集成
│   ├── utils/          # 工具函数
│   │   └── pnlCalculator.ts  # 盈亏计算逻辑
│   ├── types.ts        # TypeScript 类型定义
│   ├── App.tsx         # 主应用组件
│   └── main.tsx        # 应用入口
├── package.json
└── vite.config.ts
```

## 开发

项目使用 Vite 作为构建工具，支持热模块替换（HMR）。

## License

MIT


