# 快捷面板 / Quick Panel

> 当前版本：1.0.0

DSH Desktop 的快捷面板插件：在 DSH 窗口内提供一个浮岛与面板，并附带一个可常驻桌面的独立小应用（Electron 伴生窗）。

- **DSH 内**：侧边栏入口 → 顶部浮岛 → 下拖面板；待办、提醒、实时消息、快速输入。
- **独立小应用**：默认顶部浮岛（360×48，置顶、不占任务栏），点开为 440 宽面板；托盘常驻；关闭面板只收起为浮岛。

## 环境要求

- Windows（独立小应用依赖 Electron 与 Windows 窗口 API）。
- DSH Desktop（Host 半区需要 `webServer` 与 `sessionController`）。
- 独立小应用复用 `%USERPROFILE%\.dsh\electron\electron.exe`（通常由 dsh-pet 下载）。缺失时打开独立窗会提示失败。

## 安装

在当前 profile 中通过插件管理安装本目录：

```
plugin_manager install_bundle  target = <项目目录>
```

安装后：

- **修改 `client.js`、`panel/` 资源**：刷新 DSH 页面即可；
- **修改 `index.js`（Host 半区）**：需要重启 DSH；
- **修改 `runtime/electron-helper/`**：托盘退出独立窗后重开。

## 从 DSH 市场安装

仓库公开并开启 GitHub Pages 后，DSH → Plugins → Discover / Settings 添加插件索引：

```text
https://cinewave0.github.io/cinewave0-dsh-quick-panel/market/index.json
```

然后搜索 `Quick Panel` 安装 1.0.0。索引固定到 Git commit，版本更新后需要重新安装。

不要把本目录的 `package.json` / `cordis.patch.yml` 手写进 profile；统一走 `install_bundle`。

## 使用

### DSH 内

- 侧边栏底部的快捷面板按钮打开浮岛；
- 浮岛显示最新一句 / 时间 / 运行呼吸灯；
- 点浮岛展开面板：待办、提醒、实时消息、底部快速输入；
- 待办左侧勾选 = 填入 DSH 输入框（不自动发送）；`↵` 在独立窗中填入输入框；
- 待办和提醒条目按当前显示顺序显示 `1.` `2.` 数字序号；
- 提醒支持翻页时钟、重复、提示音；
- 实时消息支持用户 / 助手 / 推理 / 代码 / 工具 / 错误、流式光标、上滚加载更早；
- 用户消息里的图片显示缩略图（Host 通过当前对话的附件引用读取，不在实时消息里传 base64）。

### 独立小应用

- DSH 面板底部的「打开独立面板」启动；默认先出现顶部浮岛；
- 点浮岛文字或 `⌃` 展开面板；拖动浮岛左侧 `⠿` 移动；
- 面板 X = 收起到浮岛；托盘菜单可打开面板 / 收起到浮岛 / 退出；
- 面板宽度固定 440，高度默认 720、可拖上下边缘；保留原生标题栏拖动和边框，不添加双击贴右、自定义拖动或热区；
- 用户消息缩略图可点击，在独立窗内查看原图（Esc 或点遮罩关闭）；
- 权限请求会显示批准卡片：Enter 允许一次，Esc 或“拒绝”按钮拒绝；处理期间快速输入暂时锁定；
- DSH 的 1/2/3 选项问题会镜像到独立窗，选择/填写后可直接提交；
- DSH 不在对话页时，实时消息由 Host 继续镜像最近事件，并支持上滚加载更早；
- 时钟右侧显示余额（与时钟同尺寸）和本次 token 总量、输出速度、最近 30 天 token 总量（日期字号）；
- 托盘退出才会真正结束小应用。

## 数据

- 共享存储：`%USERPROFILE%\.dsh\quick-panel\state.json`（待办、提醒、设置、当前会话 id）
- 窗口位置：`%USERPROFILE%\.dsh\quick-panel\window.json`
- 启动诊断：`%USERPROFILE%\.dsh\quick-panel\helper.log`
- DSH 面板的本地数据会在启动时迁移到 Host 存储；Host 不可用时回退 localStorage。

## 常见问题

**打不开独立面板**

- DSH 面板提示「Host 未连接」：Host 半区未加载，重启 DSH；
- 提示其他错误：查看 `helper.log` 的 spawn / exit 记录；
- 独立窗启动后立即消失：确认 Electron 路径存在，或查看 `helper.log` 的沙箱重试记录。

**独立窗没有实时消息**

- 独立窗优先使用 DSH 对话页的实时镜像；离开对话页 5 秒后改用 Host 镜像；
- Host 镜像保留最近事件，上滚可加载更早；流式 partial 仍依赖 DSH 对话页；
- 如果完全没有消息，确认当前 DSH 对话与独立窗的「对话」标签一致。

**提醒不响**

- 首次使用需与页面交互一次以解锁音频；
- 独立窗打开时，DSH 面板的提醒到点逻辑会暂停，由独立窗处理；
- 独立窗关闭后，DSH 面板恢复提醒。

## 已知限制

- 仅 Windows；独立小应用依赖 DSH 运行与 `$DSH_HOME/electron`；
- 独立窗实时消息：Host 能在 DSH 离开对话页后继续镜像新的已结算事件，并在上滚时从 Host 会话事件加载更早；流式 partial 仍依赖 DSH 对话页；
- 独立窗问题卡：当前会话的 pending 问题会镜像；多题用上一题/下一题，提交后等待 DSH 确认；
- 图片缩略图：DSH 面板覆盖已加载的历史消息；独立窗覆盖 Host 镜像的当前窗口；原图由 Host 按附件引用按需读取，超过 16 MiB 的附件不预览；
- 权限批准卡：独立窗心跳在线且当前对话匹配时，由外部面板接管审批并抑制 DSH 内建卡；关闭独立窗、心跳丢失或 120 秒未处理时交还 DSH 内建卡；
- 时间栏的“30 日”是本机 DSH 会话投影的近似总量（含缓存读取），不是平台账单；余额需要已登录 DeepSeek 账号，API Key 模式显示 `—`，余额缓存约 5 分钟；
- 多显示器/跨 DPI 场景未完整验证；
- 独立窗提醒与 DSH 面板的“单一负责人”协调仍在完善。

## 开发目录

```
index.js                     Host：共享存储、本地 API（含图片附件读取）、live、prompt/stop、静态资源
client.js                    DSH 客户端：浮岛/面板/待办/提醒/实时消息/输入
panel/                       独立窗页面（HTML/CSS/JS/icon）
runtime/electron-helper/     独立窗主进程与 preload
locale/                      插件标题/描述
```

## License

MIT
