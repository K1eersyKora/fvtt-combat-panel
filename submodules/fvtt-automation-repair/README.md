# FVTT 统一自动化修复 1.0.2

适用 Foundry VTT 13.351 / dnd5e 5.1.10。统一承接原战斗面板中的规则和施法适配、幸运、战斗大师、神秘武器与绝地职业，以及此前 DSH 的物品迁移修复。

依赖 Midi-QOL、Chris's Premades、DAE、Socketlib、libWrapper、Times Up 和 Midi Item Showcase Community。GP 匕首之云使用已启用的 Gambit's Premades 与 Region Attacher。

- 现有角色通过 `game.modules.get("fvtt-automation-repair").api.migrateWorld` 幂等迁移；应用前必须提供完整备份回调。保留物品 ID、现有资源和原有伤害骰。
- `api.snapshotWorld()` 提供备份数据；`api.migrateWorld({apply:false})` 只扫描。
- 所有修复实现保存在本模组。兼容旧宏和物品中的简短调用入口，由统一注册表执行。
- `fvtt-lucky`、`fvtt-battle-master` 的旧执行入口应停用。`mystic-weapon-pack` 1.5.0 是单独的纯模板包。
- 战斗面板 0.15.5 及队伍与剧情 0.2.6 提供界面；动作状态、多目标和传送适配调用本模组。

已丢失的历史法术模板无法根据损坏引用重建原位置；需要重新施法。变形期间保留维持专注所需的法术数据，不开放兽形原本不能重新施放的法术。


## 公开安装与完整说明

安装清单：

```text
https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-automation-repair.json
```

[全部修复作用与验证边界](https://github.com/K1eersyKora/fvtt-combat-panel/blob/main/docs/AUTOMATION.md) · [安装与升级](https://github.com/K1eersyKora/fvtt-combat-panel/blob/main/docs/UPGRADING.md) · [套件模块说明](https://github.com/K1eersyKora/fvtt-combat-panel/blob/main/docs/MODULES.md)

停用旧 fvtt-lucky、fvtt-battle-master，旧神秘武器包应更新到无启动脚本的1.5.0。完整迁移由GM显式执行；启用前先备份。apply:false返回清单，不是逐项差异。snapshotWorld()为相关世界API数据快照，不替代整个世界目录及素材备份。
