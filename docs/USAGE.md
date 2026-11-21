# 战斗面板安装与使用指南


本指南适用于战斗面板 0.15.16，验证环境为 Foundry 13.351 / D&D5e 5.1.10。

## 安装

1. 打开公开仓库 `K1eersyKora/fvtt-combat-panel`，从 README 表格复制对应模组的 manifest 链接。
2. 在 Foundry 设置页打开「附加模组 → 安装模组」，把链接粘贴到 Manifest URL 字段并安装。
3. 进入世界，在“管理模组”中启用，优先启用依赖。

## 依赖

自动化修复（`fvtt-automation-repair`）是战斗面板的必需项。请先安装下列依赖。

- midi-qol
- chris-premades
- dae
- socketlib
- lib-wrapper
- times-up
- midi-item-showcase-community（>=1.6.2）

`fvtt-3d-tabletop` 与 `fvtt-mc-builder` 是两个 3D 选项，按需独立安装。首次创建场景及玩家操作见 [三维工具上手](3D-USAGE.md)。

## 基本操作

1. 选中自己有权限控制的角色棋子，确认底部 HUD 出现。
2. 点击底部的武器或法术，根据活动选择攻击模式、法术位或可用次数。
3. 将鼠标移到一个可见的合法目标上。白色双弧围住棋子，红标开始旋转。移开可换目标，按 Esc 可取消准备。
4. 单目标活动点击后进入结算。多目标活动按面板计数继续点选，范围活动按提示放置模板或确认目标。命中率是预估，实际结果以骰点和规则结算为准。

## 升级与迁移

GM 可以先在浏览器控制台运行只读预检，查看世界和对象清单。

```js
await game.modules.get("fvtt-automation-repair").api.migrateWorld({ apply: false })
```

需要迁移已有卡片时，GM 应保存世界备份并提供可持久化的备份回调，再运行应用操作。具体接口与返回值见 [自动化说明](AUTOMATION.md)。

升级后请复核旧的执行入口。

- 停用已由统一引擎接管的独立 Lucky 和 Battle Master。
- 启用队伍集成检定时，停用独立 BG3 检定。
