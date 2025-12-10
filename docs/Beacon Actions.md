# Beacon Actions

Beacon Provider 只保留最小的 `action` 集合，专注于提供当前 Minecraft 世界的 MTR 数据快照：静态结构数据已经由 Bukkit 端通过 `world/mtr` 直接采集并缓存，Provider 只需要返回动态的 `RailwayData` 状态，供前端/Beacon 进行进一步的处理。

## 1. 可用 Action 一览

| Action 名称 | 说明 | 请求 `payload` | 响应结构 |
|-------------|------|----------------|----------|
| `beacon:ping` | 验证 Gateway 通信，并测量往返延迟。 | 可选：`echo` (`string`) | `echo`（原样返回）、`receivedAt`（服务器时间，ms）、`latencyMs`（处理耗时） |
| `mtr:get_railway_snapshot` | 返回一个或多个维度当前的 `RailwayData` 快照（MessagePack 格式 + Base64 编码），仅支持读操作。 | 可选：`dimension`（如 `minecraft:overworld`），不传则返回所有缓存的维度。 | `format: "messagepack"`，`snapshots` （数组，每项包含 `dimension`, `timestamp`, `length`, `payload`（Base64）） |

## 2. 新 Action 的响应说明

- `snapshots`：数组，每个元素对应一个维度的 `RailwayData`。  
  - `dimension`: 维度标识（`ResourceLocation` 字符串）。  
  - `timestamp`: 服务端序列化时的毫秒时间戳。  
  - `length`: 解码后的原始 MessagePack 字节数。  
  - `payload`: 使用 `Base64` 编码的 MessagePack 数据，解码后可交由 Bukkit/前端复用 `RailwayData` 模块提供的逻辑进一步解析。
- `format`（根级）：目前固定为 `"messagepack"`，用于说明 `payload` 的编码格式。

调用方只需解析 Base64 并交给 MessagePack 解析器，即可得到与 `world/mtr` 存储结构等价的 `stations`、`platforms`、`routes`、`depots`、`rails`、`signalBlocks`、`sidings` 等集合，用作进一步的 Leaflet 可视化或数据对比。

## 3. 扩展与注意事项

- provider 仍保留 `PingAction` 用于连接检测，所有 MTR 逻辑通过 `MtrQueryGateway` 的快照缓存（`MtrSnapshotCache`）读取，防止在主线程上频繁重新构建 `RailwayData`。  
- 如果需要覆盖维度筛选或补充额外的 `payload` 字段，可以在 Bukkit 端负责格式化，Provider 只负责将 `RailwayData` 原封不动地序列化为 MessagePack 并返回。  
- 对于大文件/高频请求场景，建议在客户端缓存解码后的快照，并结合 `timestamp` 判断是否需要重新请求。  
