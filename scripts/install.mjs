#!/usr/bin/env node
/**
 * 把 dsh-archive-cleaner 装进当前 DSH profile（默认 ~/.dsh/profiles/desktop）。
 *
 * 做三件事：备份 package.json → 在 profile 的 node_modules 里做一个指向本仓库的
 * junction 目录 → 把包名写进 dsh.profile.bundles 和 dependencies（link: 本地路径）。
 *
 *   node scripts/install.mjs            # 安装 / 更新
 *   node scripts/install.mjs --remove   # 卸载（删 junction，删两处配置项）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'))
const name = pkg.name
const remove = process.argv.includes('--remove')

const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const profileDir = process.env.DSH_PROFILE_DIR ?? path.join(dshHome, 'profiles', 'desktop')
const manifestFile = path.join(profileDir, 'package.json')
const linkPath = path.join(profileDir, 'node_modules', name)

if (!fs.existsSync(manifestFile)) {
  console.error(`找不到 profile：${manifestFile}`)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
const bundles = (manifest.dsh.profile.bundles ??= [])
manifest.dependencies ??= {}

if (remove) {
  if (fs.existsSync(linkPath) || isBrokenLink(linkPath)) fs.rmSync(linkPath, { force: true, recursive: false })
  const at = bundles.indexOf(name)
  if (at >= 0) bundles.splice(at, 1)
  delete manifest.dependencies[name]
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`已卸载：${name}`)
  process.exit(0)
}

// 1. 备份
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
fs.copyFileSync(manifestFile, `${manifestFile}.bak-${stamp}`)

// 2. node_modules 里的目录链接
fs.mkdirSync(path.dirname(linkPath), { recursive: true })
if (fs.existsSync(linkPath) || isBrokenLink(linkPath)) fs.rmSync(linkPath, { force: true, recursive: false })
fs.symlinkSync(pluginRoot, linkPath, 'junction')

// 3. 配置项
if (!bundles.includes(name)) bundles.push(name)
manifest.dependencies[name] = `link:${pluginRoot.replaceAll('\\', '/')}`
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')

// 4. 校验
const resolved = await import(pathToFileURL(path.join(linkPath, 'lib', 'index.js')).href).then(
  (m) => `ok (apply/inject = ${typeof m.apply}/${JSON.stringify(m.inject)})`,
  (error) => `失败：${error.message}`,
)
console.log(`已安装 ${name} → ${linkPath}`)
console.log(`  profile: ${profileDir}`)
console.log(`  bundles: ${bundles.length} 项，含 ${name}`)
console.log(`  宿主模块加载：${resolved}`)
console.log('重启 DSH 后生效：左侧边栏 + 菜单里会出现「归档清理」。')

function isBrokenLink(p) {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}
