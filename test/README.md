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
- 问题卡：问题镜像、答案请求、ack 清理；
- Host feed：种子回填、live 事件追加、客户端 feed 优先。

这个测试只跑 Node，不需要 DSH/Electron。

## 2. 独立窗面板测试

```powershell
node test/panel.test.mjs
```

它会：

1. 起一个假 Host，给面板喂固定数据；
2. 启动 Electron 打开独立窗页面；
3. 自动断言：时钟/余额同尺寸、三项指标同日期字号、审批卡显示、Enter 允许、Esc 拒绝、输入框锁定、待办/提醒序号、问题卡显示/选项/提交、缩略图加载、点击看原图；
4. 把截图写到 `test/output/panel.png`。

注意：如果 PowerShell 本身在受限沙箱里，Electron 可能因命名管道被拒绝而启动失败；在普通终端运行即可。

## 3. 真实 DSH 冒烟检查

不需要点 UI，可以只读 `/state`：

```powershell
# 先取得 token（同源 Referer 兜底）
$cfg = Invoke-RestMethod -Uri 'http://127.0.0.1:5602/quick-panel/config' `
  -Headers @{ Referer='http://127.0.0.1:5602/' }
Invoke-RestMethod -Uri ("http://127.0.0.1:5602/quick-panel/state?token=" + $cfg.token) |
  Select-Object activeSessionId,sessionLabel,running,approval,usage
```

## 4. 仍需要人工看的

自动化能覆盖逻辑和 DOM，但这些只能人眼/耳朵确认：

- 窗口拖动、多显示器、125% 缩放；
- 提示音是否只响一次；
- 托盘图标/菜单；
- 真实审批卡在桌面上的出现位置。

这些不需要“长任务”，可以单独做小测试；不需要把 stop/queue/steer 混在一起。
