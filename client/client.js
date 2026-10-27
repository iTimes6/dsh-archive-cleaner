// dsh-archive-cleaner — 浏览器半
//
// 走 DSH 的客户端模块格式（window.__ModuleLoader__.load），不经过打包器：
// 内部只 require('react')，UI 全部用 React.createElement 手写。
//
// 依赖 dsh-better-sidebar 提供的 ctx.betterSidebar 服务：注册一个 tab，
// 列表/删除都打到宿主半注册的 HTTP 路由 /archive-cleaner/api/*。

;(() => {
  function makeFactory() {
    return (require) => {
      const React = require('react')
      const h = React.createElement
      const { useCallback, useEffect, useMemo, useState } = React

      const ROUTE = 'archive-cleaner/api'

      // ── 小工具 ────────────────────────────────────────────────────────────

      const routeOf = (ctx, suffix) => {
        const path = `${ROUTE}/${suffix}`
        const sidebar = ctx === null || ctx === undefined ? undefined : ctx.betterSidebar
        if (sidebar !== undefined && sidebar !== null && typeof sidebar.hostRouteUrl === 'function') {
          return sidebar.hostRouteUrl(path)
        }
        return new URL(path, document.baseURI).toString()
      }

      const call = async (ctx, suffix, init) => {
        const response = await fetch(routeOf(ctx, suffix), init)
        let payload = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        if (!response.ok || payload === null || payload.ok !== true) {
          const message = payload === null || payload.error === undefined ? `HTTP ${response.status}` : String(payload.error)
          throw new Error(message)
        }
        return payload
      }

      const formatBytes = (bytes) => {
        if (typeof bytes !== 'number' || bytes <= 0) return '0 B'
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
      }

      const formatTime = (ms) => {
        if (typeof ms !== 'number' || ms <= 0) return '—'
        const d = new Date(ms)
        const pad = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      }

      const shortId = (id) => (id.startsWith('session-') ? id.slice(8, 16) : id.slice(0, 8))

      // ── 样式 ──────────────────────────────────────────────────────────────

      const COLORS = {
        border: 'color-mix(in srgb, currentColor 14%, transparent)',
        subtle: 'color-mix(in srgb, currentColor 62%, transparent)',
        faint: 'color-mix(in srgb, currentColor 45%, transparent)',
        hover: 'color-mix(in srgb, currentColor 7%, transparent)',
        danger: '#e5484d',
        dangerBg: 'color-mix(in srgb, #e5484d 12%, transparent)',
      }

      const S = {
        root: {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          fontSize: 13,
          color: 'inherit',
        },
        bar: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${COLORS.border}`,
          flex: '0 0 auto',
        },
        barTitle: { fontWeight: 600, marginRight: 'auto' },
        ghost: {
          appearance: 'none',
          background: 'transparent',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 12,
          padding: '4px 9px',
          lineHeight: 1.4,
        },
        dangerBtn: {
          appearance: 'none',
          background: COLORS.dangerBg,
          border: `1px solid color-mix(in srgb, ${COLORS.danger} 45%, transparent)`,
          borderRadius: 6,
          color: COLORS.danger,
          cursor: 'pointer',
          fontSize: 12,
          padding: '4px 10px',
          lineHeight: 1.4,
          fontWeight: 600,
        },
        list: { flex: '1 1 auto', overflowY: 'auto', minHeight: 0, padding: '4px 0' },
        row: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          padding: '8px 12px',
          cursor: 'pointer',
        },
        rowMain: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 auto' },
        rowTitle: {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 500,
        },
        rowMeta: { fontSize: 11.5, color: COLORS.subtle, display: 'flex', gap: 8, flexWrap: 'wrap' },
        rowPath: { fontSize: 11, color: COLORS.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        footer: {
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 12px',
          borderTop: `1px solid ${COLORS.border}`,
          fontSize: 12,
          color: COLORS.subtle,
        },
        empty: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          flex: '1 1 auto',
          color: COLORS.subtle,
          padding: 24,
          textAlign: 'center',
        },
        notice: { fontSize: 12, padding: '0 12px 8px', color: COLORS.subtle },
        noticeError: { fontSize: 12, padding: '0 12px 8px', color: COLORS.danger },
      }

      const TrashIcon = ({ size = 16 }) =>
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          h('path', { d: 'M4 7h16' }),
          h('path', { d: 'M10 4h4' }),
          h('path', { d: 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12' }),
          h('path', { d: 'M10 11v6M14 11v6' }),
        )

      // ── 面板 ──────────────────────────────────────────────────────────────

      const makePanel = (ctx) => {
        const Panel = () => {
          const [sessions, setSessions] = useState([])
          const [loading, setLoading] = useState(true)
          const [busy, setBusy] = useState(false)
          const [error, setError] = useState(null)
          const [notice, setNotice] = useState(null)
          const [picked, setPicked] = useState(() => [])

          const refresh = useCallback(async () => {
            setLoading(true)
            setError(null)
            try {
              const payload = await call(ctx, 'list', { method: 'GET' })
              const list = Array.isArray(payload.sessions) ? payload.sessions : []
              setSessions(list)
              setPicked((current) => current.filter((id) => list.some((item) => item.id === id)))
            } catch (err) {
              setError(String(err === null || err === undefined ? '未知错误' : err.message ?? err))
            } finally {
              setLoading(false)
            }
          }, [])

          useEffect(() => {
            void refresh()
          }, [refresh])

          const pickedSet = useMemo(() => new Set(picked), [picked])
          const pickedBytes = useMemo(
            () => sessions.reduce((sum, item) => (pickedSet.has(item.id) ? sum + item.size : sum), 0),
            [sessions, pickedSet],
          )
          const totalBytes = useMemo(() => sessions.reduce((sum, item) => sum + item.size, 0), [sessions])

          const toggle = (id) => {
            setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
          }

          const remove = async () => {
            if (picked.length === 0 || busy) return
            const ok = window.confirm(
              `永久删除选中的 ${picked.length} 个归档会话？\n\n会删掉磁盘上的会话记录（${formatBytes(pickedBytes)}），无法恢复。`,
            )
            if (!ok) return
            setBusy(true)
            setError(null)
            setNotice(null)
            try {
              const payload = await call(ctx, 'delete', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ids: picked }),
              })
              const deleted = Array.isArray(payload.deleted) ? payload.deleted : []
              const skipped = Array.isArray(payload.skipped) ? payload.skipped : []
              const SKIP_TEXT = {
                'not-archived': '没归档',
                locked: '文件被占用',
                'invalid-id': 'id 不对',
              }
              const skipText =
                skipped.length === 0
                  ? ''
                  : `；跳过 ${skipped.length} 个（${skipped
                      .map((item) => `${shortId(item.id)} ${SKIP_TEXT[item.reason] ?? item.reason}`)
                      .join('、')}）`
              setNotice(`已删除 ${deleted.length} 个，释放 ${formatBytes(payload.freedBytes ?? 0)}${skipText}`)
              setPicked([])
              await refresh()
            } catch (err) {
              setError(String(err === null || err === undefined ? '删除失败' : err.message ?? err))
            } finally {
              setBusy(false)
            }
          }

          if (loading && sessions.length === 0) {
            return h('div', { style: S.root }, h('div', { style: S.empty }, '正在读取归档会话…'))
          }

          if (error !== null && sessions.length === 0) {
            return h(
              'div',
              { style: S.root },
              h('div', { style: Object.assign({}, S.empty, { color: COLORS.danger }) }, `读取失败：${error}`),
              h(
                'div',
                { style: { display: 'flex', justifyContent: 'center', paddingBottom: 24 } },
                h('button', { style: S.ghost, onClick: () => void refresh() }, '重试'),
              ),
            )
          }

          const allPicked = sessions.length > 0 && picked.length === sessions.length

          return h(
            'div',
            { style: S.root },
            h(
              'div',
              { style: S.bar },
              h(
                'label',
                { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }, title: '全选 / 全不选' },
                h('input', {
                  type: 'checkbox',
                  checked: allPicked,
                  ref: (el) => {
                    if (el !== null) el.indeterminate = picked.length > 0 && !allPicked
                  },
                  onChange: () => setPicked(allPicked ? [] : sessions.map((item) => item.id)),
                }),
                h('span', { style: S.barTitle }, `归档会话 ${sessions.length}`),
              ),
              h('button', { style: S.ghost, onClick: () => void refresh(), disabled: loading }, loading ? '刷新中…' : '刷新'),
              h(
                'button',
                {
                  style: picked.length === 0 || busy ? Object.assign({}, S.dangerBtn, { opacity: 0.5, cursor: 'default' }) : S.dangerBtn,
                  onClick: () => void remove(),
                  disabled: picked.length === 0 || busy,
                },
                busy ? '删除中…' : picked.length === 0 ? '删除' : `删除 ${picked.length} 个`,
              ),
            ),
            notice !== null ? h('div', { style: S.notice }, notice) : null,
            error !== null ? h('div', { style: S.noticeError }, error) : null,
            sessions.length === 0
              ? h(
                  'div',
                  { style: S.empty },
                  h(TrashIcon, { size: 22 }),
                  h('div', null, '没有归档的会话'),
                  h('div', { style: { fontSize: 11.5 } }, '在会话列表里归档的会话会出现在这里'),
                )
              : h(
                  'div',
                  { style: S.list },
                  sessions.map((item) =>
                    h(
                      'label',
                      {
                        key: item.id,
                        style: Object.assign({}, S.row, pickedSet.has(item.id) ? { background: COLORS.hover } : null),
                      },
                      h('input', {
                        type: 'checkbox',
                        checked: pickedSet.has(item.id),
                        onChange: () => toggle(item.id),
                        style: { marginTop: 2 },
                      }),
                      h(
                        'div',
                        { style: S.rowMain },
                        h('span', { style: S.rowTitle }, item.title === null || item.title === undefined ? '（无标题）' : item.title),
                        h(
                          'span',
                          { style: S.rowMeta },
                          h('span', null, formatBytes(item.size)),
                          h('span', null, formatTime(item.mtime)),
                          h('span', null, item.onDisk === true ? shortId(item.id) : `${shortId(item.id)} · 文件已不存在`),
                          item.workspace !== null && item.workspace !== undefined && item.workspace.title !== null
                            ? h('span', null, item.workspace.title)
                            : null,
                        ),
                        item.cwd !== null && item.cwd !== undefined
                          ? h('span', { style: S.rowPath, title: item.cwd }, item.cwd)
                          : null,
                      ),
                    ),
                  ),
                ),
            h(
              'div',
              { style: S.footer },
              h('span', null, `共 ${sessions.length} 个 · ${formatBytes(totalBytes)}`),
              picked.length > 0 ? h('span', null, `已选 ${picked.length} 个 · ${formatBytes(pickedBytes)}`) : null,
            ),
          )
        }
        return Panel
      }

      // ── 插件 ──────────────────────────────────────────────────────────────

      const name = 'dsh-archive-cleaner-client'
      const inject = ['betterSidebar']

      function apply(ctx) {
        const Panel = makePanel(ctx)
        ctx.effect(() =>
          ctx.betterSidebar.registerTab({
            id: 'archive-cleaner',
            title: () => '归档清理',
            description: () => '勾选后永久删除已归档的会话',
            icon: (size) => h(TrashIcon, { size }),
            order: 60,
            single: true,
            component: () => h(Panel),
          }),
        )
      }

      const module = { exports: {} }
      module.exports = { apply, inject, name }
      return module.exports
    }
  }

  if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
    window.__ModuleLoader__.load({ id: 'dsh-archive-cleaner', factory: makeFactory() })
  }
})()
