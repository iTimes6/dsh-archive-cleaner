# dsh-archive-cleaner · 归档清理

DSH Web GUI 侧边栏插件：把**归档会话**列成一屏，勾选后批量删除。

## 装 / 卸

```bash
node scripts/install.mjs            # 装进 ~/.dsh/profiles/desktop（会先备份 package.json）
node scripts/install.mjs --remove   # 卸载
```

装完要**重启 DSH**（宿主半在启动时加载）。之后侧边栏顶部 `+` → 「归档清理」。

`DSH_HOME` / `DSH_PROFILE_DIR` 环境变量可覆盖默认路径。

## 用法

面板里每一行是一个归档会话：勾选框、标题、工作区、大小、归档时间。

- 「全选」/「反选」/「清空」
- 搜索框按标题或 id 过滤
- 「删除选中 (n)」→ 再点一次确认 → 调宿主 `POST /archive-cleaner/api/delete`

删除操作做的事（按 id）：

1. `rm -r ~/.dsh/sessions/<bucket>/<id>/` —— 会话本体（`session.v4.jsonl.zstd` 在里面）
2. `~/.dsh/storages/session_projcache/sessions/<id>.json` —— 标题/预览缓存
3. 从 `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`、各工作区 `sessionIds`、`global.pinnedSessionIds` 里摘掉

**不可恢复**，所以面板里有二次确认；未归档或正在运行的会话会被拒（`skipped` 里给原因）。

## 结构

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主半：注册 `GET /archive-cleaner/api/list`、`POST /archive-cleaner/api/delete` |
| `client/client.js` | 浏览器半：`ctx.betterSidebar.registerTab()` 注册侧边栏页签，手写 `window.__ModuleLoader__` 包装 |
| `cordis.patch.yml` | 往插件树里 insert 一行 |
| `package.json` | `dsh.bundle.patch` + `dsh.client.inject: ["betterSidebar"]` + `exports["./client"]` |

依赖注入：宿主半 `inject: ['webServer']`；客户端半的 `package.json` 只声明 `dsh.client.inject: ["@deepseek-ai/dsh-client-connection"]`（模块加载顺序），真正的服务依赖写在 bundle 里——`client/client.js` 导出的 `inject` 为 `['betterSidebar']`。

## 从源码装

```bash
git clone https://github.com/iTimes6/dsh-archive-cleaner.git
cd dsh-archive-cleaner
node scripts/install.mjs
```

`scripts/install.mjs` 会把本目录以 junction 链到 `~/.dsh/profiles/desktop/node_modules/dsh-archive-cleaner`，往该 profile 的 `package.json` 里加依赖和 bundle 登记，并备份改动前的 `package.json`。`--remove` 撤干净。

要删掉插件本身：`node scripts/install.mjs --remove`，然后把目录删了即可。

## 要求

- DSH 0.2.1-rc.1+（要 `ctx.betterSidebar` 这个扩展点）
- 装了 [`dsh-better-sidebar`](https://github.com/fuhefei/dsh-better-sidebar)（侧边栏本体；本插件只往它的页签里加一格）
- 无第三方运行时依赖

## License

MIT

## 接口

```
GET  /archive-cleaner/api/list
→ { ok, totalBytes, sessions: [{ id, title, size, archived, onDisk, live, workspace }] }

POST /archive-cleaner/api/delete   { ids: string[] }
→ { ok, deleted: string[], skipped: [{ id, reason }], freedBytes }
```

`reason` ∈ `not-archived` / `live-session` / `invalid-id`。请求带 `Origin` 时必须同源，否则 403。
