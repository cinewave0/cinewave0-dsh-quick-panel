# 发布到 DSH 插件市场

仓库：<https://github.com/cinewave0/cinewave0-dsh-quick-panel>

**当前状态：仓库已推送并设为私密；GitHub Pages 在私密状态下不可访问（HTTP 404）。脱敏完成后，把仓库改回 public，并在 Settings → Pages 重新开启 Pages。**

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

git push origin main --tags
```

注意顺序：**先提交源码，再生成 index**。索引里的 commit 必须指向包含插件代码的那个提交；不要把 index 提交自己的 commit 写进去。

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
node test/panel.test.mjs
```

## 8. 安全

插件 bundle 会在 DSH Host 进程里执行代码。发布时请：

- 不放 token、账号、聊天记录、截图中的隐私信息；
- 在 README 写清楚权限、外部窗口、网络请求范围；
- 保持 MIT LICENSE；
- 对每个版本使用固定 commit，避免分支漂移。
