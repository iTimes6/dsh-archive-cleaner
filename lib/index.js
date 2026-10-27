// dsh-archive-cleaner — 宿主半
//
// 只做两件事：
//   1. GET  <prefix>/list   —— 列出 workspace.json 里 global.archivedSessionIds 的会话，
//                              带上标题、目录、占用大小、最后修改时间。
//   2. POST <prefix>/delete —— 永久删除选中的归档会话（会话目录 + 投影缓存 + 索引里的 id）。
//
// 数据位置（DSH 0.x）：
//   <DSH_HOME>/storages/workspace.json                               归档 id 列表 / 各工作区 sessionIds
//   <DSH_HOME>/sessions/<编码后的 cwd>/session-<uuid>/session.v4.jsonl.zstd   会话本体
//   <DSH_HOME>/storages/session_projcache/sessions/<id>.json          标题等投影
//
// 删的是磁盘上的东西，没有回收站 —— 前端会先弹确认框。

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-archive-cleaner'
export const inject = ['webServer']

const ROUTE_PREFIX = '/archive-cleaner/api'
const ID_RE = /^[A-Za-z0-9._-]{1,120}$/

export function apply(ctx) {
  const handler = async (req, res) => {
    if (!(await fence(ctx, req))) {
      writeJson(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const tail = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
    try {
      if (tail === 'list' && req.method === 'GET') {
        const home = dshHome()
        const payload = await listArchived(home)
        writeJson(res, 200, { ok: true, ...payload })
        return
      }
      if (tail === 'delete' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const ids = Array.isArray(body?.ids) ? body.ids : []
        const result = await deleteArchived(ctx, dshHome(), ids)
        writeJson(res, 200, { ok: true, ...result })
        return
      }
      writeJson(res, 404, { ok: false, error: `unknown route: ${tail || '(empty)'}` })
    } catch (error) {
      writeJson(res, 500, { ok: false, error: String(error?.message ?? error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
    'dsh-archive-cleaner: routes',
  )
}

// ── 路径 ────────────────────────────────────────────────────────────────────

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

const workspaceFileOf = (home) => path.join(home, 'storages', 'workspace.json')
const projcacheFileOf = (home, id) => path.join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)

// ── 读 ──────────────────────────────────────────────────────────────────────

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** 扫 <home>/sessions/<cwd>/<session-dir|session-file>，给出 id → 磁盘信息。 */
async function buildSessionIndex(home) {
  const index = new Map()
  let buckets = []
  try {
    buckets = await fsp.readdir(path.join(home, 'sessions'), { withFileTypes: true })
  } catch {
    return index
  }
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue
    const bucketDir = path.join(home, 'sessions', bucket.name)
    let entries = []
    try {
      entries = await fsp.readdir(bucketDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.name.startsWith('session-')) continue
      const full = path.join(bucketDir, entry.name)
      if (entry.isDirectory()) {
        const { size, mtime } = await measure(full)
        index.set(entry.name, { id: entry.name, kind: 'dir', dir: full, size, mtime, bucket: bucket.name })
      } else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd')) {
        const id = entry.name.replace(/\.jsonl(\.zstd)?$/, '')
        const { size, mtime } = await measure(full)
        index.set(id, { id, kind: 'file', dir: full, size, mtime, bucket: bucket.name })
      }
    }
  }
  return index
}

async function measure(target) {
  try {
    const stat = await fsp.stat(target)
    if (stat.isFile()) return { size: stat.size, mtime: stat.mtimeMs }
    let size = 0
    let mtime = stat.mtimeMs
    let entries = []
    try {
      entries = await fsp.readdir(target, { withFileTypes: true })
    } catch {
      return { size, mtime }
    }
    for (const entry of entries) {
      const child = await measure(path.join(target, entry.name))
      size += child.size
      if (child.mtime > mtime) mtime = child.mtime
    }
    return { size, mtime }
  } catch {
    return { size: 0, mtime: 0 }
  }
}

/** 从投影缓存里取标题 / cwd / 创建时间。 */
async function readMeta(home, id) {
  const record = (await readJson(projcacheFileOf(home, id)))?.record
  const title = record?.rows?.title?.val
  return {
    title: typeof title === 'string' && title.trim() !== '' ? title.trim() : null,
    cwd: typeof record?.identity?.cwd === 'string' ? record.identity.cwd : null,
    createdAt: typeof record?.identity?.createdAt === 'number' ? record.identity.createdAt : null,
  }
}

function workspaceOf(ws, id) {
  const workspaces = ws?.tables?.workspaces
  if (workspaces === null || typeof workspaces !== 'object') return null
  for (const [workspaceId, value] of Object.entries(workspaces)) {
    if (Array.isArray(value?.sessionIds) && value.sessionIds.includes(id)) {
      return { id: workspaceId, title: value.title ?? null, path: value.path ?? null }
    }
  }
  return null
}

async function listArchived(home) {
  const ws = (await readJson(workspaceFileOf(home))) ?? {}
  const archived = Array.isArray(ws?.global?.archivedSessionIds) ? ws.global.archivedSessionIds : []
  const index = await buildSessionIndex(home)

  const sessions = []
  for (const id of archived) {
    if (typeof id !== 'string') continue
    const hit = index.get(id)
    const meta = await readMeta(home, id)
    const workspace = workspaceOf(ws, id)
    sessions.push({
      id,
      title: meta.title,
      cwd: meta.cwd ?? workspace?.path ?? null,
      workspace: workspace === null ? null : { title: workspace.title, path: workspace.path },
      size: hit?.size ?? 0,
      mtime: hit?.mtime ?? meta.createdAt ?? 0,
      onDisk: hit !== undefined,
    })
  }
  sessions.sort((a, b) => b.mtime - a.mtime)
  return {
    home,
    sessions,
    totalBytes: sessions.reduce((sum, item) => sum + item.size, 0),
  }
}

// ── 删 ──────────────────────────────────────────────────────────────────────

/**
 * 以前这里按宿主内存里的 sessions 注册表判断「正在运行」，结果被这个会话一次性打开过的
 * 会话永远算 live——归档了就再也删不掉。现在不再相信内存判断：直接删，真被文件占用
 * （EBUSY / EPERM）才报 locked，让 OS 来做唯一权威。
 */
async function deleteArchived(ctx, home, rawIds) {
  const ids = [...new Set(rawIds.filter((id) => typeof id === 'string' && ID_RE.test(id)))]
  const ws = await readJson(workspaceFileOf(home))
  if (ws === null || typeof ws !== 'object') throw new Error('无法读取 workspace.json，已中止（一个文件都没有删）')

  const archived = Array.isArray(ws?.global?.archivedSessionIds) ? ws.global.archivedSessionIds : []
  const archivedSet = new Set(archived)
  const index = await buildSessionIndex(home)

  const deleted = []
  const skipped = []
  let freedBytes = 0

  for (const id of ids) {
    if (!archivedSet.has(id)) {
      skipped.push({ id, reason: 'not-archived' })
      continue
    }
    const hit = index.get(id)
    let removed = false
    if (hit !== undefined) {
      try {
        await fsp.rm(hit.dir, { recursive: true, force: true })
        removed = true
        freedBytes += hit.size
      } catch (error) {
        const code = error?.code
        skipped.push({
          id,
          reason: code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' ? 'locked' : `fs-error: ${String(code ?? error?.message ?? error)}`,
        })
        continue
      }
    }
    try {
      await fsp.rm(projcacheFileOf(home, id), { force: true })
    } catch {
      /* 缓存删不掉不影响结论 */
    }
    deleted.push(id)
    archivedSet.delete(id)
    void removed
  }

  if (deleted.length > 0) {
    const gone = new Set(deleted)
    ws.global.archivedSessionIds = archived.filter((id) => !gone.has(id))
    if (Array.isArray(ws.global.pinnedSessionIds)) {
      ws.global.pinnedSessionIds = ws.global.pinnedSessionIds.filter((id) => !gone.has(id))
    }
    const workspaces = ws?.tables?.workspaces
    if (workspaces !== null && typeof workspaces === 'object') {
      for (const value of Object.values(workspaces)) {
        if (Array.isArray(value?.sessionIds)) value.sessionIds = value.sessionIds.filter((id) => !gone.has(id))
      }
    }
    await writeJsonAtomic(workspaceFileOf(home), ws)
  }

  return { deleted, skipped, freedBytes }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fsp.rename(tmp, file)
}

// ── HTTP 小工具 ─────────────────────────────────────────────────────────────

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * 宿主自己的准入栅栏：优先用 ctx.connection.requestRejection（Host/Origin + 登录态都归宿主裁决），
 * 拿不到该服务时退化成同源校验。
 */
async function fence(ctx, req) {
  try {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection
    if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
      const rejection = connection.requestRejection(req)
      const settled = rejection !== null && typeof rejection?.then === 'function' ? await rejection : rejection
      return settled === undefined
    }
  } catch {
    /* 服务不在就继续走退化路径 */
  }
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === req.headers?.host
  } catch {
    return false
  }
}
