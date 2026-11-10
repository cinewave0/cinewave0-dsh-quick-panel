# 发布到 DSH 插件市场

仓库：<https://github.com/cinewave0/cinewave0-dsh-quick-panel>

**当前状态：GitHub 路线（npm 暂缓）。仓库转 public 后，在 Settings → Pages 开启 `main / (root)`，索引固定到 v1.0.5-beta.1 的 commit `6fbda1f6eb6b438907b45c7337c863ada8c8669b`。**

DSH 市场不是上传到某个后台，而是读取一个 **HTTPS 上的 plugin market index JSON**。  
本项目的索引文件是 `market/index.json`，发布后地址为：

```text
https://cinewave0.github.io/cinewave0-dsh-quick-panel/market/index.json
```

GitHub 只负责托管源码、索引和详情页；是否出现在“官方市场”还取决于官方索引是否收录，需要向官方索引提 PR 或联系维护方。

## 1. 创建 GitHub 仓库

在 GitHub 创建一个 **空仓库**：

```text
cinewave0/cinewave0-dsh-quick-panel
```

不要勾选自动生成 README、.gitignore 或 LICENSE。

## 2. 首次发布

当前本地仓库已经初始化并发布过。发布历史可能被压缩为一个 release commit；用 `git log --oneline` 查看当前提交。

只需在 GitHub 创建空仓库后执行：

```powershell
cd '<项目目录>'
git push -u origin main --tags
```

如果从零开始、没有本地 git 历史，完整流程是：

```powershell
cd '<项目目录>'

git init -b main
git add .
git commit -m "release: v1.0.0"

node scripts/make-market-index.mjs
git add market/index.json
git commit -m "market: add v1.0.0"
git tag v1.0.0

git remote add origin https://github.com/cinewave0/cinewave0-dsh-quick-panel.git
git push -u origin main --tags
```

## 3. 开启 GitHub Pages

仓库 → Settings → Pages：

- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/(root)`

保存后等 1–2 分钟，访问：

```text
https://cinewave0.github.io/cinewave0-dsh-quick-panel/market/index.json
```

能看到 JSON 就说明市场索引可读。

> DSH 拉索引不跟随重定向，请使用最终地址；不要用带 `/blob/` 的 GitHub 页面地址。

## 4. 在 DSH 里验证

DSH → Plugins → Discover / Settings：

- 添加 index URL：`https://cinewave0.github.io/cinewave0-dsh-quick-panel/market/index.json`
- 搜索 `Quick Panel`
- 安装 1.0.0

或者在 agent 里用 `plugin_manager` 安装固定 commit：

```text
install_bundle target = git+https://github.com/cinewave0/cinewave0-dsh-quick-panel.git#<40位commit>
```

安装 bundle 会执行 Host 代码，需要 Full access 或审批。

## 5. 后续版本发布

```powershell
cd '<项目目录>'

# 1. 改版本号，例如 1.0.1
#    package.json -> version

# 2. 先提交源码（这个 commit 会被市场固定）
git add .
git commit -m "release: v1.0.1"

# 3. 用当前 HEAD 生成索引
node scripts/make-market-index.mjs

# 4. 提交索引
git add market/index.json
git commit -m "market: add v1.0.1"
git tag v1.0.1

node scripts/check-market-index.mjs   # 索引 commit 的 package.json 版本必须与索引一致
git push origin main --tags
```

注意顺序：**先提交源码，再生成 index**。索引里的 commit 必须指向包含插件代码的那个提交；不要把 index 提交自己的 commit 写进去。Release workflow 也会跑 `check-market-index.mjs`，索引指向旧版本会直接让发布失败。

## 5.1 首次打开自动安装 Electron

从 macOS 侧移植：Host 在 `openWindow()` 里解析 Electron（`DSH_QUICK_PANEL_ELECTRON` → `%USERPROFILE%\.dsh\electron\electron.exe`）。缺失时自动下载固定版本（43.3.0）的 win32 x64/arm64 zip，校验 SHA-256 后解压到 `%USERPROFILE%\.dsh\electron`，再由客户端轮询 `/quick-panel/runtime` 显示进度并重试开窗。

- 校验值写在 `index.js` 的 `ELECTRON_ARTIFACTS`；升级 Electron 版本要同时更新版本号、两个 zip 的 SHA-256 与字节数；
- 镜像：`DSH_QUICK_PANEL_ELECTRON_MIRROR`；离线：`DSH_QUICK_PANEL_NO_RUNTIME_DOWNLOAD=1`；
- 解压优先用系统 `tar`（bsdtar 可读 zip），失败回退 PowerShell `Expand-Archive`；
- 测试：`node test/runtime-install.test.mjs`（Windows 上真实下载/校验/解压迷你 zip）。

## 6. 官方索引

公共的 DSH 市场索引由维护方决定收录。通常流程：

1. 先把上面的自建索引跑通；
2. 找到官方索引仓库；
3. 给官方 index 提 PR，加入同一个条目；
4. 等维护方审核。

没有“上传 GitHub 就自动出现在官方市场”的机制。

## 7. 发布前检查

- `package.json` 的 `version` 与 `market/index.json` 一致；
- `package.json` 的 `name` 与 index 的 `name` 一致；
- `dsh.bundle.patch` 指向 `cordis.patch.yml`；
- `panel/`、`runtime/` 在 `files` 列表里；
- `engines.dsh` 与当前 DSH 版本兼容；
- 仓库里没有 `state.json`、`window.json`、`helper.log`、`test/output/` 等本地数据；
- 发布前跑一遍：

```powershell
node test/host.test.mjs
node test/runtime-install.test.mjs   # Windows 真实解压（CI 的 ubuntu 会跳过）
node test/restart-prompt.test.mjs
node test/panel.test.mjs
npm run check:market
```

## 8. 安全

插件 bundle 会在 DSH Host 进程里执行代码。发布时请：

- 不放 token、账号、聊天记录、截图中的隐私信息；
- 在 README 写清楚权限、外部窗口、网络请求范围；
- 保持 MIT LICENSE；
- 对每个版本使用固定 commit，避免分支漂移。

## 9. 构建、备份与同步

- `client.js` 是构建产物：编辑 `src/client/main.js`，运行 `node scripts/build-client.mjs`；CI 会校验产物与源码一致。
- 备份：`node scripts/backup.mjs`，默认写到 `../backups`，生成 zip + `.sha256` + `.manifest.json`（含版本、分支、HEAD、未提交路径）。
- 同步：`node scripts/sync-github.mjs --message "..."` 会先跑 Host 测试再 push；`--dry-run` 只看计划，`--no-push` 只提交；直连 GitHub 被重置时加 `--proxy http://127.0.0.1:7897`（或设 `DSH_GIT_PROXY`）。
- CI：`.github/workflows/ci.yml` 在 push/PR 时构建 client、校验产物、跑客户端/Host 测试与打包检查。
- Windows 上从 link 开发切回市场安装：先在插件页卸载，再删除残留 junction，**否则 pnpm 替换该路径时会顺着 junction 清理项目目录（含 `.git`）**：
  ```powershell
  cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-quick-panel"
  ```

## 10. tag 发布（GitHub Release）

推送 `v*` tag 会触发 `.github/workflows/release.yml`：

1. 校验 tag 与 `package.json` 版本一致；
2. 校验 `market/index.json` 里存在该版本且带 `engines.dsh`（`scripts/check-market-index.mjs` 还会校验索引 commit 的 `package.json` 版本）；
3. 构建 + 校验产物 + lint + 客户端/Host 测试；
4. `npm pack` 并生成 `SHA256SUMS`；
5. 创建 GitHub Release：说明页先拼 `.github/release-notes-header.md`（安装方式、平台要求、必须完全退出 DSH 再打开、首次自动下载 Electron），再接自动生成的变更摘要；
6. 如果仓库配置了 `NPM_TOKEN` secret，再执行 `npm publish`（没有则跳过）。

```powershell
git tag v1.0.2
node scripts/sync-github.mjs --tags --message "release: v1.0.2"
```

npm 账号没解决之前，先把 Release 作为分发渠道；以后补上 `NPM_TOKEN` 即可自动发布。

## 11. GitHub 路线正式发布

1. 仓库转 **public**（Settings → General → Danger Zone）；
2. Settings → Pages：Source = `Deploy from a branch`，Branch = `main`，目录 `/ (root)`；
3. 确认索引可访问且格式正确：

```powershell
curl.exe -sS https://cinewave0.github.io/cinewave0-dsh-quick-panel/market/index.json
```

4. `market/index.json` 的 source 用 **git commit**，指向已发布的 tag 对应 commit；
5. 每个新版本：先打 `vX.Y.Z` tag 触发 Release，再把 `market/index.json` 的版本/commit 更新到该 tag，提交并推送（Pages 会自动重建）。

当前已发布：`v1.0.5-beta.1`（commit `6fbda1f`），索引 source 已指向该 commit；上一稳定版 `v1.0.4`（commit `fff04bb`）。beta tag 会被 Release workflow 标记为 Pre-release，不会顶掉 Latest。

> **已解决（v1.0.4，2026-11-09）**：正式版的 tag 快照已包含最新 README、`docs/panel.png`、`SECURITY.md` 与测试说明；Release 说明由 `.github/release-notes-header.md` 统一补充安装与重启要求。以后发版按第 5 节的顺序提交（源码 → 索引），不要先打 tag 再补文档。

> npm 发布恢复后，可把 source 切回 `{"type":"npm"}` 并发布对应版本；两种路线可以并存，但索引里一个版本只有一个 source。
