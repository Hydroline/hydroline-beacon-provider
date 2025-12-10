# hydroline-beacon-provider

Hydroline Beacon Provider exposes shared telemetry logic that can be shipped on both Fabric and Forge without depending on legacy Architectury shims. The repository is intentionally structured per Minecraft release so that each loader can evolve on its own upgrade cadence.

## layout
```
root
├── common/           # shared logic compiled once (Java 8 target)
├── fabric-1.16.5/    # Fabric loader entrypoint for MC 1.16.5
├── fabric-1.18.2/
├── fabric-1.20.1/
├── forge-1.16.5/     # Forge loader entrypoint for MC 1.16.5
├── forge-1.18.2/
└── forge-1.20.1/
```

## building
- Single module: `./gradlew :fabric-1.20.1:build` or `./gradlew :forge-1.18.2:build`
- Whole Minecraft target: `./gradlew buildTarget_1_18_2`
- Everything: `./gradlew buildAllTargets`

Each loader jar automatically bundles the compiled `common` classes/resources, so deployables remain self-contained.

## actions
- Provider 端现在仅保留 `beacon:ping` 与 `mtr:get_railway_snapshot` 两个 action，所有 MTR 结构数据由 Bukkit 端直接扫描 `world/mtr`，Provider 只负责将 `RailwayData` 快照序列化后原封返回。详细协议参考 `docs/Beacon Actions.md`。
