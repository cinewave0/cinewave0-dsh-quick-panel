> **安装或更新后必须完全退出 DSH 再重新打开**：托盘菜单 → 退出（或任务管理器结束 DSH 进程），确认进程消失后再打开。只关闭窗口或刷新页面（F5 / Ctrl+R）不够；首次安装时页面里的插件入口还没加载，看到“Host 未连接”不是插件坏了。首次打开独立面板会自动下载并安装 Electron（约 140 MB）。

## 安装

**方式一：DSH 插件页（推荐）**

插件 → 发现 → 添加索引源：

```text
https://cinewave0.github.io/cinewave0-dsh-quick-panel/market/index.json
```

然后搜索 **Quick Panel** 安装。**装完必须完全退出 DSH，确认进程消失后重新打开**；只刷新页面不够。重新打开后第一次点“打开独立面板”会自动下载并安装 Electron 43.3.0（约 140 MB），不需要 dsh-pet 或手工解压。

**方式二：本页的 Release 包**

下载本页附带的 `dsh-quick-panel-<version>.tgz`，先用 `SHA256SUMS` 校验：

```powershell
certutil -hashfile dsh-quick-panel-<version>.tgz SHA256
```

然后在 DSH 插件页的安装入口填 tgz 的**绝对路径**；装了 `dsh` CLI 的环境也可以用：

```powershell
dsh plugin --profile desktop add <下载目录>\dsh-quick-panel-<version>.tgz
```

**方式三：钉到 git commit**

```powershell
dsh plugin --profile desktop add "git+https://github.com/cinewave0/cinewave0-dsh-quick-panel.git#<commit>"
```

## 平台要求

| | 要求 |
|---|---|
| DSH | `>=0.2.2-rc.1 <0.3.0` |
| Windows | 10/11；独立窗需要 Electron 43.3.0，首次打开自动下载到 `%USERPROFILE%\.dsh\electron` |

下载源优先 npmmirror、失败回退 GitHub Releases，zip 的 SHA-256 固定在校验表里。离线环境可设 `DSH_QUICK_PANEL_NO_RUNTIME_DOWNLOAD=1` 后手动安装，或设 `DSH_QUICK_PANEL_ELECTRON` 指向已有 `electron.exe`。

> 本项目**不发布 npm**，只有上面三个渠道。装完或升级后请完全退出 DSH 再打开（Host 半区改动必须重启才生效）。

## 变更
