# SRT 字幕时轴修复工具

一个修复 SRT 字幕时间轴的 Web 应用：上传字幕文件并输入不可跨越的场景切点，系统按
**最短显示时长 · 最大每秒字符数（CPS）· 最小间隔** 联动调整时间轴。调整严格保持字幕
先后顺序、不越过任何场景切点；当约束无解时，会标出造成冲突的**最小连续字幕段**及原因。
页面提供修复前后对照表和结果下载。

技术栈：Node.js + Express + 原生前端（无框架）。

## 快速开始（Docker）

```bash
docker compose up --build
```

该命令会自动安装依赖、构建镜像并启动服务。启动后访问：

**http://localhost:3000**

### 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口（compose 中映射为 `3000:3000`） |

除端口外无需其他配置。如需修改宿主机端口，编辑 `compose.yaml` 中的 `ports`，
例如 `"8080:3000"` 后访问 http://localhost:8080。

## 本地开发（不用 Docker）

```bash
npm install
npm start        # http://localhost:3000
npm test         # 运行核心算法单元测试（node:test）
```

## 使用说明

1. 选择 `.srt` 字幕文件（或点击「载入示例」体验）。
2. 设置参数：
   - **最短显示时长（毫秒）**：每条字幕至少显示的时长，默认 1000。
   - **最大每秒字符数（CPS）**：默认 20。每条字幕所需时长 ≥ 可见字符数 ÷ CPS
     （字符数统计会去掉 HTML 标签、ASS 样式块和换行，含空格）。
   - **最小间隔（毫秒）**：相邻字幕之间的最小时间间隔，默认 100。
3. 输入**场景切点**：每行一个，支持 `HH:MM:SS,mmm`、`MM:SS` 或纯秒数（如 `83.5`），可留空。
   任何字幕调整后的时间区间都不会跨越这些时间点。
4. 点击「开始修复」，查看修复前后对照表；点击「下载修复后的 SRT」保存结果。

### 调整规则

- 每条字幕的实际时长 = `max(原始时长, 最短显示时长, 字符数 / 最大CPS)`，只延长不缩短。
- 字幕只会被**向后平移 / 延长**，不会提前于原始开始时间；先后顺序保持不变。
- 场景切点把时间轴划分为若干场景段，字幕不会跨段，也不会越过切点。
- **无解时**：标出造成冲突的最小连续字幕段（红色行），说明所需空间与可用空间，
  冲突段在输出文件中保留原始时间，其余字幕正常修复。

### 无解示例

切点 `00:00:05,000` 前需容纳 3 条各需 2 秒的字幕（含间隔共 6.2 秒），空间不足时会得到
类似提示：`字幕 #2 – #3 构成最小冲突段：……共需 4.10s，但可用空间只有 2.90s`。

## API

### `POST /api/repair`

请求（JSON）：

```json
{
  "srt": "1\n00:00:01,000 --> 00:00:01,300\n你好\n",
  "minDurationMs": 1000,
  "maxCps": 20,
  "minGapMs": 100,
  "cuts": "00:00:05,000\n83.5"
}
```

响应（JSON）：

```json
{
  "ok": true,
  "stats": { "total": 1, "adjusted": 1, "unchanged": 0, "conflict": 0 },
  "conflicts": [],
  "subtitles": [
    {
      "index": 1, "text": "你好", "chars": 2, "requiredMs": 1000,
      "oldStart": 1000, "oldEnd": 1300, "newStart": 1000, "newEnd": 2000,
      "status": "adjusted"
    }
  ],
  "srt": "1\n00:00:01,000 --> 00:00:02,000\n你好\n"
}
```

- `ok`：是否全部满足约束（无冲突）。
- `conflicts[]`：`{ type, startIndex, endIndex, reason }`，`type` 为
  `no-space`（场景段内空间不足）或 `crosses-cut`（原始时间轴本身跨越切点）。
- `subtitles[].status`：`unchanged` / `adjusted` / `conflict`。
- `srt`：修复后的完整 SRT 文本（冲突段保留原始时间）。

### `GET /api/health`

健康检查，返回 `{ "ok": true }`。

## 项目结构

```
server.js          Express 服务与 API
src/srt.js         SRT 解析 / 序列化、时间戳工具
src/repair.js      核心修复算法（约束求解 + 最小冲突段定位）
public/            原生前端（index.html / app.js / style.css）
test/              核心算法单元测试
Dockerfile         多阶段精简镜像（node:20-alpine）
compose.yaml       一键启动
```
