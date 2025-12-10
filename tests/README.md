# Beacon Provider Action Tests

该目录提供一个最小的 Node.js 脚本，用来直接通过 Netty Gateway 调用 Beacon Provider 的所有 action，并将响应写入 `tests/output` 目录，方便人工校验或与网站端对比。

## 运行前准备

1. **确保 Provider 已启动**：Fabric/Forge 端需要运行并监听 `config/hydroline/beacon-provider.json` 中的 `listenAddress`/`listenPort`（默认 `127.0.0.1:28545`）。
2. **准备 Node.js ≥ 18**：脚本只依赖内置模块，无需安装额外依赖。
3. **可选：配置 `.env`**（位于 `tests/.env`，脚本会自动加载）：

   ```ini
   PROVIDER_HOST=127.0.0.1
   PROVIDER_PORT=28545
   PROVIDER_TOKEN=change-me
   PROVIDER_MTR_DIMENSION=minecraft:overworld
   PROVIDER_ROUTE_ID=
   PROVIDER_STATION_ID=
   PROVIDER_PLATFORM_ID=
   PROVIDER_DEPOT_ID=
   NODE_LIMIT=512
   OUTPUT_DIR=./output
   REQUEST_TIMEOUT_MS=15000
   ```

   > `*_ID` 为空时脚本会尝试根据返回数据自动选择路线 / 站点 / 车厂；如果无法推断则跳过相应 action。

## 执行

```bash
cd tests
node test-actions.js
```

脚本会：

- 读取/清空 `output` 目录；
- 与 Netty Gateway 建立 TCP 连接并完成握手；
- 顺序调用所有 action（包括 `mtr:list_nodes_paginated` 的所有分页），将响应逐一写入 `output/*.json`；
- 自动根据 `mtr:list_network_overview`/`mtr:list_stations`/`mtr:list_depots` 的返回值挑选示例路线/站点/车厂，继续调用 `mtr:get_route_detail`、`mtr:get_route_trains`、`mtr:get_station_timetable`、`mtr:get_depot_trains` 等。

如需调试，可直接查看控制台日志或 `output` 中的 JSON 文件。脚本默认在 15 秒无响应时中止对应请求，你可以通过 `REQUEST_TIMEOUT_MS` 进行调整。

## 导出全部路线页面

如需对照网站的线路详情页，可运行新增的 `test-route-pages.js`：

```bash
cd tests
node test-route-pages.js
# 或使用 pnpm test:routes
```

该脚本将：

- 读取 `.env`，连接与 `test-actions.js` 相同的 Provider；
- 解析 `mtr:list_network_overview` 中的全部路线 ID（支持 64 位长整型），逐一调用 `mtr:get_route_detail` 与 `mtr:get_route_trains`；
- 将结果写入 `output/routes/mtr_route_<routeId>_{detail,trains}.json`，同时生成 `routes_index.json` 方便定位；
- 可通过 `ROUTES_OUTPUT_DIR` 环境变量自定义输出目录。

因此只需运行一次，就能拿到所有线路的原始 JSON，避免因 JS Number 精度丢失而出现“Route not found”等 404。
