# Flight Seat Advisor (No Local DB)

## Voice Edit Demo

仓库同时提供一个独立的、单文件语音触屏交互演示：

- 本地路径：`public/voice-edit-demo.html`
- Render 路径：`/voice-edit-demo.html`

该页面的图片与交互资源均内嵌在 HTML 中，可直接通过浏览器访问和分享。

一个不落本地数据库的航班座椅避坑查询网页：

- 输入 `起飞地 + 目的地 + 日期`
- 或直接输入 `航班号 + 日期`（如 `CZ8581`）
- 起降地支持输入“全球城市名 / 机场名 / IATA / ICAO”（如 `深圳`、`SZX`、`London`、`EGLL`）
- 日期使用 `年/月/日` 下拉菜单选择
- 实时查询当天航班（FlightAware 路由页抓取）
- 廉航过滤可选（默认关闭；可通过参数或前端勾选启用）
- 抓取 SeatMaps 公开页面，提取经济舱 `Pitch/Width/Recline`
- 参考 AeroLOPA 公开接口（机型、舱位布局、座舱图链接）
- 基于航线方位 + 起飞时刻太阳方位估算左右舷（观景优先侧 / 防晒优先侧）
- 按“座椅宽敞度”排序并给出综合建议

## 1. 启动

```bash
cd /Users/11123683/Documents/Playground/flight-seat-advisor
npm start
```

打开：

- http://localhost:8788

## 2. 正式部署（Render，推荐）

项目已包含 `Dockerfile` 和 `render.yaml`，可直接部署为长期在线服务。

1. 把项目推到 GitHub 仓库（如果还没推）：

```bash
cd /Users/11123683/Documents/Playground/flight-seat-advisor
git init
git add .
git commit -m "deploy-ready: flight seat advisor"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

2. 打开 Render 控制台，新建 `Blueprint`（或 `Web Service`），选择该仓库。
3. Render 会自动读取 `render.yaml` 并创建服务。
4. 等待构建完成，访问分配的 `https://xxx.onrender.com` 域名。
5. 在 Render 服务的 `Environment` 里设置变量：
   - `SEARCHAPI_KEY` = 你的 key
6. 健康检查地址：`/api/health`。

固定域名说明：
- Render 的默认域名是 `https://<service-name>.onrender.com`
- 只要你不删除服务，后续代码更新（自动部署）域名不会变
- 建议首次创建时把服务名一次定好（例如 `flight-seat-advisor-你的标识`），避免重名

说明：
- 无需配置航班 API key。
- 若以后服务名冲突，修改 `render.yaml` 里的 `name` 后重新部署。

## 3. API

### `GET /api/health`
健康检查。

### `GET /api/config`
返回运行配置（无需航班 API key）。

### `GET /api/airports/suggest?q=london`
返回全球机场联想建议（用于输入框下拉）。

### `GET /api/search?origin=SZX&destination=LJG&date=2026-03-30`
返回筛选与座椅分析结果。

### `GET /api/search?flight=CZ8581&date=2026-03-31`
按航班号直查（服务端会先解析该航班对应航线，再筛选同日期同航班）。

### `GET /api/search?flight=CZ8582&date=2026-04-01&excludeLowCost=true`
按航班号直查并启用廉航过滤（可选参数，默认 `false`）。

## 4. 关键实现说明

- 不使用本地数据库：每次请求实时抓取 FlightAware + SeatMaps 页面。
- 航班号回退抓取：当路由页缺少目标日期时，自动回退解析 FlightAware 航班号页面（`trackpollBootstrap`）。
- 全球机场解析：实时加载公开机场索引（GitHub 数据源）并内存缓存。
- SeatMaps 数据来源：`https://seatmaps.com/airlines/...` 公开页面，不走私有接口。
- AeroLOPA 数据来源：`https://www.aerolopa.com/dummyversion/v1/...` 公开接口 + 座舱图公开链接。
- 舒适度评分：基于经济舱 `pitch/width/recline` 与页面评分做启发式打分。
- 左右舷建议：基于机场坐标、航向与太阳方位计算（用于观景/防晒辅助）。
- 风险提示：若出现窄间距、窄座宽或不可后仰，默认标记“建议规避”。

## 5. 已知限制

- 航班号可能临时换机，同航班不同机号体验会变。
- SeatMaps 未覆盖机型会显示“数据不足”。
- 抓取源页面结构变化时，可能需要调整解析逻辑。
