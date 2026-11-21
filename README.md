# Foundry 战斗面板与三维工具

v0.15.16 包含七个战斗与自动化模块，以及两个独立的三维工具。二维双弧锁定框支持悬停预览、顺时针旋转和解除淡出。验证环境为 Foundry 13.351 / D&D5e 5.1.10。

## 安装

在 Foundry 设置页打开「附加模组 → 安装模组」，复制所需模组清单的链接并粘贴至 Manifest URL。进入世界后启用相应模块和依赖。更新旧世界前先备份。[安装与升级](docs/UPGRADING.md)

| 模组 | 版本 | 用途 | Foundry 安装清单 |
|---|---:|---|---|
| BG3 战斗面板 | 0.15.16 | 底部 HUD、武器和法术准备、双弧锁定框与命中预测 | [module.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/module.json) |
| 队伍与剧情 | 0.2.7 | 队伍总览、剧情和投票、集成 BG3 检定 | [fvtt-party-tools.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-party-tools.json) |
| 先攻栏 | 0.1.6 | 顶部先攻立绘、GM 切换回合、剧情开战联动 | [fvtt-bg3-initiative.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-bg3-initiative.json) |
| 倒地与死亡豁免 | 0.1.3 | 0 HP 标记、死亡豁免刻度和回合处理 | [fvtt-bg3-downed.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-bg3-downed.json) |
| 遭遇提示音 | 0.1.1 | 入战提示音与可选自动先攻 | [fvtt-bg3-encounter-sfx.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-bg3-encounter-sfx.json) |
| 统一自动化修复 | 1.0.9 | 职业、法术、物品、资源消耗与存量数据迁移 | [fvtt-automation-repair.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-automation-repair.json) |
| 物品与职业模板 | 1.5.5 | 14 张物品／职业模板和 29 张法术／特性模板 | [mystic-weapon-pack.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/mystic-weapon-pack.json) |
| 三维跑团 | 0.1.7 | 三维镜头、高低差、施法与专注显示 | [fvtt-3d-tabletop.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-3d-tabletop.json) |
| 方块建造 | 0.6.8 | GM 方块场景编辑、构件、门和玩家通行 | [fvtt-mc-builder.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-mc-builder.json) |

独立 ZIP 适合按需安装。手动完整安装可将整包中的九个模组文件夹解压至 `Data/modules/`，再按实际用途启用。三维工具依赖使用者已有的 3D Canvas 8.x 和 libWrapper，建造场景与普通三维跑团请分别配置。[下载 v0.15.16](https://github.com/K1eersyKora/fvtt-combat-panel/releases/tag/v0.15.16)

## 文档

- [更新说明](CHANGELOG.md) · [面板安装与使用](docs/USAGE.md) · [各模组功能与依赖](docs/MODULES.md)
- [统一自动化与迁移 API](docs/AUTOMATION.md) · [43 项模板目录](docs/ITEM-CATALOG.md)
- [三维跑团与方块建造上手](docs/3D-USAGE.md) · [3D 地图生成、易错部位和排错](docs/3D-MAP-GUIDE.md)
- [本版验证范围](docs/VALIDATION.md)

根目录是战斗面板，其余八个模块的可编辑源码位于 `submodules/<模块ID>/`。模板 JSON 位于 `submodules/mystic-weapon-pack/sources/`。两个三维工具的动画来源与许可见各自的 `assets/fx/ATTRIBUTION.txt`。
