# 研究记录（2025-12-11）

## RailwayData 快照内容

- `mtr.data.RailwayData`（可在 `libs/mtr3/**/MTR-forge-1.18.2-3.2.2-hotfix-1-slim.jar` 中查看）里包含：
  - 完整的 `rails` 映射结构（`Map<BlockPos, Map<BlockPos, Rail>>`），与 `world/mtr/<namespace>/<dimension>/rails` 下持久化的数据一一对应；
  - `stations`、`platforms`、`routes`、`depots`、`sidings`、`signalBlocks` 等集合，以及 `RailwayDataRouteFinderModule`、`RailwayDataDriveTrainModule` 等模块；
  - `signalBlocks` 通过 UUID 关联到具体轨道，足够拼出精细轨迹几何。

- `NodeInfo`（由 `MtrDataMapper.collectNodes` 导出）并不存成独立文件，而是运行时根据 `rails` 端点及平台/站点元数据聚合而来，因此每个节点的原始坐标已经存在于 `RailwayData.rails` 中，重新构建节点图只是对这张映射的确定性遍历。

## 对 Beacon Provider 的影响

- 既然 `RailwayData` 就是完整的轨道拓扑与运行时状态的来源，我们可以直接把它当作真正的“数据源”，不再需要频繁读取 `world/mtr`：
  1. 可直接读取 `railwayData.rails` 及其相关集合（只读，无需反复调用 `RailwayData#getInstance`）并序列化，而不是扫描持久化文件；
  2. `world/mtr` 下的目录其实只是这份内存数据的 MessagePack 备份，适合离线分析但非必须；
  3. 节点可以在线根据 `signalBlocks` + `rails` 重新计算，Leaflet/Beacon 可以用这些数据重建精细轨迹，不依赖保存的 `nodes` 输出。

## 下一步研究方向

1. 定义一个“快照提取器”，直接读取 `RailwayData` 字段（只读）并构建静态拓扑快照，避免触发重计算；
2. 评估是否继续保留 `world/mtr` 作为版本化的持久层，还是直接将这些快照自己序列化（可参考 `tools/mtr-world-dump.js` 的逻辑但由实时 `RailwayData` 驱动）；
3. 将实时需求（时刻表 / 列车位置）与只读访问对齐：让 Provider 继续处理动态接口，Beacon 则消费缓存下来的静态快照。
