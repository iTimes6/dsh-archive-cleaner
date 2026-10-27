// 一键清掉某个会话（归档列表里删不掉时的手动后门）：
//   node scripts/purge-one.mjs <sessionId> [更多 id...]
// 做和插件删除一样的三件事：删会话目录、删投影缓存、从 workspace.json 里摘掉。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const home = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
const ids = process.argv.slice(2).filter((id) => /^session-[0-9a-f-]{36}$/i.test(id))
if (ids.length === 0) {
  console.error('用法: node scripts/purge-one.mjs <session-xxxxxxxx-....-xxxxxxxxxxxx>')
  process.exit(1)
}

const sessionsRoot = path.join(home, 'sessions')
const workspaceFile = path.join(home, 'storages', 'workspace.json')
const projcacheFile = (id) => path.join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)

/** 找到会话目录：sessions/<bucket>/<id>/ */
function findDir(id) {
  for (const bucket of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue
    const candidate = path.join(sessionsRoot, bucket.name, id)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const result = { home, deleted: [], skipped: [] }

for (const id of ids) {
  const dir = findDir(id)
  if (dir !== null) {
    try {
      await fsp.rm(dir, { recursive: true, force: true })
    } catch (error) {
      result.skipped.push({ id, reason: 'locked', detail: String(error?.code ?? error?.message ?? error) })
      continue
    }
  }
  try {
    await fsp.rm(projcacheFile(id), { force: true })
  } catch {
    /* 缓存删不掉不影响结论 */
  }
  result.deleted.push(id)
}

if (result.deleted.length > 0) {
  const ws = JSON.parse(await fsp.readFile(workspaceFile, 'utf8'))
  const gone = new Set(result.deleted)
  const strip = (list) => (Array.isArray(list) ? list.filter((id) => !gone.has(id)) : list)
  if (ws?.global) {
    ws.global.archivedSessionIds = strip(ws.global.archivedSessionIds)
    ws.global.pinnedSessionIds = strip(ws.global.pinnedSessionIds)
  }
  for (const value of Object.values(ws?.tables?.workspaces ?? {})) {
    if (value && Array.isArray(value.sessionIds)) value.sessionIds = strip(value.sessionIds)
  }
  const tmp = `${workspaceFile}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify(ws), 'utf8')
  await fsp.rename(tmp, workspaceFile)
  result.workspaceUpdated = true
}

console.log(JSON.stringify(result, null, 2))
