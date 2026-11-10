# 自动化测试

这些测试不依赖你的操作，直接在本机跑。面试/演示时可以把它当成“我怎么独立验收”。

## 1. Host 逻辑测试

```powershell
node test/host.test.mjs
```

覆盖：

- `/state` token 校验；
- 图片附件注册、读取、缓存；
- 审批接管：allow / reject / stale / 其他对话委派 / 已有 pending 委派；
- 用量：30 日聚合、当前会话 fallback、余额缓存；
- 最近会话：5 个槽位、按活动时间排序、归档过滤、切换请求与 ack、非法/未知 id 拒绝；
- 新建会话：`new-session` 排队、ack、会话变化时清除；
- 命令推送：SSE `/events` 的 token 校验与切换/新建事件；
- Electron 解析：缺失（`electron-missing`）、不是文件（`electron-unusable`）、非 loopback origin 拒绝、`/runtime` 状态与 token 校验；
- 问题卡：问题镜像、答案请求、ack 清理；
- Host feed：种子回填、live 事件追加、客户端 feed 优先。

这个测试只跑 Node，不需要 DSH/Electron。

## 1.1 首次安装 Electron（运行时供应）

```powershell
node test/runtime-install.test.mjs   # 仅 Windows 执行；CI 的 ubuntu 会跳过
```

起一个本地 HTTP 服务提供迷你 zip，走真实的下载 → SHA-256 校验 → `tar` 解压 → 合并到 `$DSH_HOME/electron`；另一个用例断言校验值不匹配时不会安装任何东西。

## 1.2 重启提示与 helper 冒烟

```powershell
node test/restart-prompt.test.mjs    # 中英文字典里的“完全退出 DSH”文案
node test/helper.test.mjs            # 真实 Electron 启动 helper，等待页面 ping（需 electron.exe）
```

`helper.test.mjs` 使用独立的 `--user-data-dir`，避免与已打开的独立窗抢单实例锁。

## 2. 独立窗面板测试

```powershell
node test/panel.test.mjs
```

它会：

1. 起一个假 Host，给面板喂固定数据；
2. 启动 Electron 打开独立窗页面；
3. 自动断言：时钟/余额同尺寸、三项指标同日期字号、审批卡显示、Enter 允许、Esc 拒绝、输入框锁定、待办/提醒序号、问题卡显示/选项/提交、缩略图加载、点击看原图、最近会话数字槽（5 格、当前高亮、点击发出切换请求、脉冲与恢复）；
4. 把截图写到 `test/output/panel.png`（整窗）和 `test/output/feed-header.png`（滚动到实时消息标题栏）。

注意：如果 PowerShell 本身在受限沙箱里，Electron 可能因命名管道被拒绝而启动失败；在普通终端运行即可。

## 3. 真实 DSH 冒烟检查

不需要点 UI，可以只读 `/state`：

```powershell
# 先取得 token（同源 Referer 兜底）；端口每次启动可能变化，用 DSH_WEB_URL 或窗口地址里的端口
$origin = $env:DSH_WEB_URL
$cfg = Invoke-RestMethod -Uri "$origin/quick-panel/config" -Headers @{ Referer = "$origin/" }
Invoke-RestMethod -Uri ("$origin/quick-panel/state?token=" + $cfg.token) |
  Select-Object activeSessionId,recentSessions,switchRequest,running,approval,usage
```

## 4. 仍需要人工看的

自动化能覆盖逻辑和 DOM，但这些只能人眼/耳朵确认：

- 窗口拖动、多显示器、125% 缩放；
- 提示音是否只响一次；
- 托盘图标/菜单；
- 真实审批卡在桌面上的出现位置。

这些不需要“长任务”，可以单独做小测试；不需要把 stop/queue/steer 混在一起。
