# 掌上跑团 0.5.5 使用说明

DM 在 Windows 电脑上开启玩家席位，玩家用 Android App 或手机浏览器配对。手机本地绘制二维地图与可用特效，桌面普通玩家会话按 Foundry 权限校验移动、执行自动化和宏，并结算资源消耗。Foundry 模组、桌面服务与手机端请使用同一版本。

## 环境要求与下载

- Foundry 13 和 D&D5e 5.1。已验证 Foundry 13.351 与 D&D5e 5.1.10。
- DM 电脑需要 Windows、Node.js 22 或更高版本与 Microsoft Edge。
- APK 最低要求 Android 8。也可用手机浏览器打开 DM 的桌面服务地址。

| 文件 | 用途 |
| --- | --- |
| [fvtt-mobile-table.json](https://github.com/K1eersyKora/fvtt-combat-panel/releases/download/mobile-v0.5.5/fvtt-mobile-table.json) | Foundry 安装清单 |
| [fvtt-mobile-table.zip](https://github.com/K1eersyKora/fvtt-combat-panel/releases/download/mobile-v0.5.5/fvtt-mobile-table.zip) | 独立 Foundry 模组，与桌面套件内的模组一致 |
| [FVTT-DM-0.5.5.zip](https://github.com/K1eersyKora/fvtt-combat-panel/releases/download/mobile-v0.5.5/FVTT-DM-0.5.5.zip) | Windows 桌面套件，包含 Foundry 模组、桌面服务与手机浏览器前端 |
| [FVTT-Mobile-0.5.5.apk](https://github.com/K1eersyKora/fvtt-combat-panel/releases/download/mobile-v0.5.5/FVTT-Mobile-0.5.5.apk) | Android 安装包 |
| [SHA256SUMS.txt](https://github.com/K1eersyKora/fvtt-combat-panel/releases/download/mobile-v0.5.5/SHA256SUMS.txt) | 下载文件的 SHA-256 校验值 |

## DM 安装与启动

1. 下载并解压 `FVTT-DM-0.5.5.zip`。
2. 在 Foundry 设置页进入「附加模组 → 安装模组」，将上表中清单的完整链接粘贴至 **Manifest URL**。如果手动安装，将套件内整个 `fvtt-mobile-table` 文件夹复制到 Foundry 用户数据的 `Data/modules` 下。两种方式任选其一，桌面服务均从 DM 套件启动。
3. 打开目标世界，在「管理模组」中启用「掌上跑团 · 2D 玩家端」。
4. 双击桌面套件内的 `启动桌面服务.cmd`，输入平时使用的完整 Foundry 地址与席位数（1 至 12，默认 1）。
5. 启动器会为每个席位打开独立的 Edge 窗口。分别登录对应的普通玩家账号，进入二维场景并选中该账号控制的棋子。可另开 GM 窗口主持。如果世界使用 Midi-QOL 的 GM 代办功能，保持 GM 在线。

### 给手机的连接地址

- **同一局域网**。使用 DM 电脑的内网 IP 和桌面服务端口，例如 `http://192.168.1.10:31940`。启动窗口会列出局域网手机地址。连不上时检查 Windows 防火墙的专用网络入站规则和访客 Wi-Fi 的客户端隔离。
- **异地联网**。由 DM 配置可信 HTTPS 反向代理或隧道，转发到桌面服务端口 `31940`。代理要透传静态资源和 `/api/` 下的配对、信令、中继与资源请求，支持长轮询并绕过缓存。联机时保持桌面服务、席位窗口和隧道运行。
- **桌面席位**。每个玩家客户端的「手机桌面服务端口」填写服务基础端口，默认 `31940`。模组自动连接基础端口加 2，默认 `127.0.0.1:31942`。该端口只供本机席位使用。若 Edge 为可信的 HTTPS Foundry 站点弹出局域网访问提示，允许后重试配对。

## 玩家安装与配对

1. 从上表下载 APK，在 Android 上打开。若系统要求允许当前来源安装，可按提示授权，安装后撤回。旧 APK 签名不同时，Android 无法覆盖安装。卸载会清除应用内下载素材和离线角色卡，先确认是否需要保留这些数据。也可以跳过 APK 安装，直接用手机浏览器打开桌面服务地址。
2. DM 在对应普通玩家席位右下角点击「手机配对」，把十位配对码私下交给玩家。桌位开启期间可重复使用同一个码。另一部手机成功配对后，控制权会转移到那部手机。
3. 在 App 填写「DM 电脑上的桌面服务地址」，点「连接桌位」，再输入配对码。浏览器版打开该地址即可输入配对码。地址变更时可在 App 配对页点「更换桌面地址」。
4. 可先点「下载世界资源包」，增量缓存权限范围内的素材和角色卡快照，也可直接点「进入世界」。「查看本机角色卡」可离线查看快照，移动、施法和掷骰需要在线席位。
5. 结束时玩家可点「断开桌位」。DM 在席位的「手机配对」窗口可「更换配对码」或「关闭桌位」。

## 玩家常用操作

- **地图与移动**。单指拖动平移本机地图，双指缩放。点「移动」后拖动地图定位，核对桌面返回的可达性和移动成本再确认。
- **角色卡与能力栏**。点己方头像打开角色卡。点能力栏的齿轮进入「能力栏与顺序」，可设置能力的显隐和排列。
- **使用能力**。点击能力后点「使用」，按提示选择目标并确认。魔法飞弹可逐枚分配给相同或不同目标。火球等二维范围法术请先核对覆盖名单。
- **聊天、掷骰与回合**。可发消息或使用组合骰。轮到自己时，展开战斗胶囊结束回合。
- **检定与反应**。支持的桌面检定与反应可在手机响应。出现「在电脑处理」时，回到对应普通玩家窗口操作。
- **概率预测**。若世界启用了支持联动的战斗面板，可将概率显示范围设为「DM 与玩家」，并核对该玩家的显示设置。能否看到命中率或目标豁免失败率，取决于版本、活动和玩家权限。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 找不到「手机配对」 | 检查当前世界是否启用模组，确认席位已用普通玩家账号进入场景，然后刷新。 |
| 手机打不开配对页 | 核对 DM 电脑的桌面服务地址和端口。局域网检查 Windows 防火墙、Wi-Fi 隔离，异地检查 HTTPS 入口与隧道。 |
| 桌面报错或配对码无效 | 保持席位窗口和桌面服务运行。检查 Edge 局域网访问权限及基础端口，再从该席位重新获取配对码。 |
| 地图或图标缺失 | 点「检查资源更新」或「重试下载」。持续失败时，检查源站是否返回 404 及该玩家是否有素材权限。 |
| 特殊宏、反应或放置范围需要进一步交互 | 回到对应普通玩家窗口处理。手机端范围预览适用于二维场景。 |

## 源码与验证

源码目录含 Foundry 模组、桌面服务、手机网页和 Android 工程。Android 可用 Windows PowerShell 运行 `android/Build-Apk.ps1`，分别以 `-Jdk`、`-BuildTools`、`-Platform` 指定 JDK、含 `aapt2` 的 Android Build Tools 及含 `android.jar` 的 API 35 平台目录。输出位于 `dist/`，自行构建的 APK 使用本机签名。[源码目录](https://github.com/K1eersyKora/fvtt-combat-panel/tree/mobile-v0.5.5/mobile-table)

此前用普通玩家会话与浏览器模拟手机验证了配对、公网双向中继与资源下载。实体 Android 手机的整场跑团仍待验证。
