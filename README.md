# BG3 操作风格战斗面板套件 0.15.5

适用于 **Foundry VTT 13.351 / D&D5e 5.1.10**。本仓库同时提供底部战斗 HUD、四个界面／表现子模组、统一自动化修复和独立模板包。每个模组均有单独的安装清单和 ZIP，也提供七模组整合 ZIP。

本次将原来分散在战斗面板、幸运、战斗大师和神秘武器包中的自动化集中到 `fvtt-automation-repair`。模板包 `mystic-weapon-pack` 1.5.0 提供 41 张模板，没有启动脚本。战斗面板 0.15.5 需要同时安装并启用统一自动化修复及其依赖。

## 模组与作用

| 模组 | 版本 | 作用 | 安装清单 |
| --- | --- | --- | --- |
| BG3 操作风格战斗面板 | 0.15.5 | 底部技能栏、资源与免费次数选择、目标选择、只读预测、准备／取消、逐角色工作流和外观设置 | [module.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/module.json) |
| BG3 队伍与剧情 | 0.2.6 | 队伍状态、移动管理、玩家限制、属性／技能检定、剧情投票、先手攻击和队友信息；临时生命独立蓝条 | [fvtt-party-tools.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-party-tools.json) |
| BG3 先攻栏 | 0.1.4 | 顶部立绘先攻、轮数跟随、GM 右键切当前回合、剧情入战与权限控制 | [fvtt-bg3-initiative.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-bg3-initiative.json) |
| BG3 倒地与死亡豁免 | 0.1.2 | 玩家角色 0 HP 指示器、成功／失败刻度及自身回合的原生死亡豁免，可独立使用 | [fvtt-bg3-downed.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-bg3-downed.json) |
| BG3 遭遇提示音 | 0.1.1 | 原生 Token HUD 入战音效、可选的四秒后自动掷先攻，以及剧情入战音效接口 | [fvtt-bg3-encounter-sfx.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-bg3-encounter-sfx.json) |
| FVTT 统一自动化修复 | 1.0.2 | 职业／法术／武器规则、幸运与战斗大师、免费次数、持续法术、变形专注、兼容宏和存量物品迁移 | [fvtt-automation-repair.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/fvtt-automation-repair.json) |
| FVTT 物品与职业模板 | 1.5.0 | 两个图鉴，包含 12 张神秘武器／绝地模板和 29 张法术／职业模板；可拖入角色卡 | [mystic-weapon-pack.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/latest/download/mystic-weapon-pack.json) |

[模组功能与依赖](docs/MODULES.md) · [自动化修复详情](docs/AUTOMATION.md) · [安装与升级](docs/UPGRADING.md) · [更新说明](CHANGELOG.md) · [验证范围](docs/VALIDATION.md) · [41 项模板目录](docs/ITEM-CATALOG.md)

## 安装

在 Foundry 设置页的「附加模组 → 安装模组」中粘贴上表对应的清单链接。先安装统一自动化修复及其依赖，再安装战斗面板；按需安装模板包和子模组，然后在世界的「管理模组」中启用并重新加载。

统一自动化修复依赖 **Midi-QOL、Chris's Premades、DAE、Socketlib、libWrapper、Times Up、Midi Item Showcase Community ≥ 1.6.2**。GP 匕首之云分支还需要 Gambit's Premades 与 Region Attacher。第三方依赖需另外安装，本发行不包含它们的程序或商业内容。

**从旧版升级时，先备份世界和模块，更新所有配套版本，停用 `fvtt-lucky`、`fvtt-battle-master` 的旧独立入口。** `mystic-weapon-pack` 必须更新到无启动脚本的 1.5.0；使用队伍检定时停用旧 `fvtt-bg3-check`，使用新先攻栏时停用重复的 Carousel 界面。存量角色需要按[升级说明](docs/UPGRADING.md)执行 GM 迁移。

[下载 v0.15.5](https://github.com/K1eersyKora/fvtt-combat-panel/releases/tag/v0.15.5)：七个独立 ZIP、七个清单、完整套件 `fvtt-combat-suite-0.15.5.zip`、中文说明和 SHA-256 校验文件。完整 ZIP 解压后是七个模组目录，放到 `Data/modules/`；GitHub 自动生成的 Source code 压缩包用于查看源码。

## 日常操作

- 选择自己有权限的角色 Token 显示底部 HUD；点击头像打开角色卡。齿轮提供配色、缩放、布局和当前客户端的自动／低配／完整性能档。
- 点击技能选择活动、法术位或免费来源，再按实际活动选择目标或落点；取消入口可结束当前角色的等待。预测受当前自动化、可见资料和动态条件限制，实际结果以系统／Midi 工作流为准。
- 队伍、检定和剧情入口由队伍与剧情子模组提供。GM 控制检定与剧情；普通玩家请求由在线 GM 验证权限和仲裁。
- 先攻栏使用原生遭遇与顺序；GM 可右键立绘切换当前回合，玩家只能按权限结束自己的回合。倒地自动豁免需要在线 GM。

## 源码

战斗面板源码位于仓库根；其余六个模组位于 `submodules/<模块ID>/`。模板可编辑 JSON 位于 `submodules/mystic-weapon-pack/sources/`，完整目录见其 `CATALOG.json`。运行时使用安装后的同级模组路径进行跨模组导入，需按模块 ID 安装。

本次沿用已有本地 GM／普通玩家针对性功能证据和五世界迁移核验；发布时重新检查脚本语法、导入、清单、包成员与附件哈希。未验证 Foundry V14、其他 D&D5e 大版本或全部第三方组合。已有丢失的范围模板位置需要重新施法恢复。

BG3 职业图标、倒地图层及音效的原始来源说明保留在各素材来源文件和子模组 README 中；相关素材权利归原权利人。
