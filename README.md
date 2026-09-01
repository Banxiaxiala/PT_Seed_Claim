# PT种子认领

在 PT 站点用户详情页，一键认领全部当前做种种子（自动翻遍所有分页）。

## 功能

- 在 `userdetails.php` 页面的「当前做种」行插入红色「一键认领」按钮
- 自动抓取当前做种列表**所有分页**（`getusertorrentlistajax.php?page=N`）的种子
- 对每个**未认领**的做种种子通过 `ajax.php` 发送 `addClaim` 请求
- 每个种子间隔 500ms，避免短时间多次请求被处理
- 实时显示认领进度（当前/总数、成功数），结束后弹窗汇总

## 安装

1. 安装油猴（Tampermonkey）或同类脚本管理器
2. 打开 [PT种子认领.user.js](./PT种子认领.user.js)
3. 安装脚本

## 使用方法

1. 登录目标站点，打开用户详情页，例如 `https://kamept.com/userdetails.php?id=20392`
2. 页面自动在「当前做种」旁出现红色「一键认领」按钮
3. 点击按钮，确认后开始批量认领，等待结束弹窗

## 支持的站点与适配

| 站点 | 域名 | 状态 |
|---|---|---|
| KamePT | kamept.com | ✅ |

## 认领机制（站点差异）

不同 NexusPHP 站点认领接口可能不同，适配新站点需确认：

- 「当前做种」行的第一格文字（KamePT 为 `当前做种`，NicePT 为 `目前做種`）
- 认领按钮选择器：`button[data-action='addClaim']` + `data-torrent_id`
- 认领接口：`POST ajax.php`，body `action=addClaim&params[torrent_id]=N`
- 做种列表分页接口：`getusertorrentlistajax.php?page=N&userid=UID&type=seeding`
- 认领成功响应：`{ret:0, data:{id}}`；失败：`{ret:!=0, msg}`

## 构建

本脚本为单个 `.user.js`，无需构建，语法校验：

```bash
node --check PT种子认领.user.js
```
