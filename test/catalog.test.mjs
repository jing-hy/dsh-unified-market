// 精选目录解析与降级链路的离线回归测试（issue #1）。
//
//   node --test test/
//
// 全部用 fixture + mock fetch，**不发真实网络请求**。
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { parseSite, siteCatalogToCatalog, loadOnlineCatalog, loadCatalog, normalizeRepoUrl } from '../lib/host.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

// ── fixture：站点 2026-09 改版后的卡片（class=card，命令在最后一个 data-cmd）──
const SITE_HTML = `
<div class="filters-band"><div class="filters">
  <button class="chip active" type="button" data-cat="all">全部 <small>4400</small></button>
  <button class="chip" type="button" data-cat="session">会话与消息 <small>286</small></button>
  <button class="chip" type="button" data-cat="ui">UI 增强 <small>761</small></button>
</div></div>
<ul class="cards">
<li class="card" data-cat="session" data-dl="322108" data-stars="384" data-added="2026-09-20" data-npm="1" data-name="billion-context">
      <div class="top">
        <h3><a href="/zh/p/ranxianglei/billion-context/" translate="no"><span class="owner">ranxianglei/</span>billion-context</a></h3>
        <span class="stars" translate="no">384</span>
      </div>
      <a class="desc-link" href="/zh/p/ranxianglei/billion-context/"><p>上下文压缩插件，兼顾小窗口省 token 与超长会话。</p></a>
      <div class="foot">
        <a class="tag" href="/zh/session/">会话与消息</a>
        <details class="inst"><summary>安装 ▾</summary><div class="menu" role="menu">
          <button type="button" role="menuitem" data-cmd="dsh plugin --profile web add dshmarket"><b>通过 dsh-market · 推荐</b></button>
          <div class="mi-cli"><b>通过命令行</b>
            <span class="cli"><input readonly value="dsh plugin --profile web add billion-context"><button class="copy" type="button" data-cmd="dsh plugin --profile web add billion-context">复制安装命令</button></span>
          </div>
        </div></details>
      </div>
    </li>
<li class="card" data-cat="ui" data-stars="8178" data-added="2026-08-28" data-name="dsh-web#packages/dsh-task-board">
      <h3><a href="/zh/p/zhu1090093659/dsh-web--packages-dsh-task-board/"><span class="owner">zhu1090093659/</span>dsh-web#packages/dsh-task-board</a></h3>
      <a class="desc-link" href="/zh/p/zhu1090093659/dsh-web--packages-dsh-task-board/"><p>侧边栏多列任务看板。</p></a>
      <button type="button" role="menuitem" data-cmd="dsh plugin --profile web add dshmarket">通过 dsh-market · 推荐</button>
      <button class="copy" type="button" data-cmd="dsh plugin --profile web add @linxin666/dsh-client-ui-task-board">复制安装命令</button>
    </li>
</ul>`

// ── fixture：旧版标记（class=item、.by span、GitHub 绝对链接、★ 星级）──
const LEGACY_HTML = `
<li class="item" data-cat="theme">
  <a href="https://github.com/foo/dsh-theme-x">dsh-theme-x</a>
  <span class="by">foo</span>
  <p>一个主题插件。</p>
  <span class="stars">★ 1,234</span>
  <button class="copy" data-cmd="dsh plugin --profile web add github:foo/dsh-theme-x">复制安装命令</button>
</li>`

// ── fixture：站点静态 JSON 目录（catalog.json，全量、卡片同构）──
function siteCatalogJson(count = 3) {
  const items = [
    {
      cat: 'session', tag: '会话与消息', dl: 322108, stars: 384, added: '2026-09-20', npm: 1,
      name: 'billion-context', owner: 'ranxianglei', short: 'billion-context',
      slug: 'ranxianglei/billion-context', desc: '上下文压缩插件。',
      cmd: 'dsh plugin --profile web add billion-context', href: '/zh/p/ranxianglei/billion-context/',
    },
    {
      cat: 'ui', tag: 'UI 增强', dl: 172427, stars: 8178, added: '2026-08-28', npm: 1,
      name: 'dsh-web#packages/dsh-task-board', owner: 'zhu1090093659', short: 'dsh-web#packages/dsh-task-board',
      slug: 'zhu1090093659/dsh-web--packages-dsh-task-board', desc: '侧边栏多列任务看板。',
      cmd: 'dsh plugin --profile web add @linxin666/dsh-client-ui-task-board',
      href: '/zh/p/zhu1090093659/dsh-web--packages-dsh-task-board/',
    },
    {
      cat: 'theme', tag: '主题与外观', dl: 100, stars: 7, added: '2026-09-01', npm: null,
      name: 'dsh-theme-x', owner: 'foo', short: 'dsh-theme-x',
      slug: 'foo/dsh-theme-x', desc: '一个主题插件。',
      cmd: 'dsh plugin --profile web add github:foo/dsh-theme-x', href: '/zh/p/foo/dsh-theme-x/',
    },
  ]
  return { install: {}, market: {}, items: items.slice(0, count) }
}

/** Install a fetch stub; every route not listed throws (no accidental real request). */
function mockFetch(routes) {
  const calls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    calls.push(u)
    const hit = Object.entries(routes).find(([frag]) => u.includes(frag))
    if (hit === undefined) throw new Error('unexpected fetch: ' + u)
    const handler = hit[1]
    const res = typeof handler === 'function' ? await handler() : handler
    if (res instanceof Error) throw res
    if (res === 'hang') return new Promise(() => {})
    return {
      ok: true,
      status: 200,
      json: async () => res.json,
      text: async () => res.text,
    }
  }
  return calls
}

test('parseSite: 按 data-cat 识别新版卡片（不再绑定 li class="item"）', () => {
  const { plugins, cats } = parseSite(SITE_HTML)
  assert.equal(plugins.length, 2, '站点改版后必须仍能解析出卡片（旧实现在此返回 0）')

  const [a, b] = plugins
  assert.equal(a.cat, 'session')
  assert.equal(a.name, 'billion-context')
  assert.equal(a.by, 'ranxianglei')
  assert.equal(a.url, 'https://github.com/ranxianglei/billion-context')
  assert.equal(a.desc, '上下文压缩插件，兼顾小窗口省 token 与超长会话。')
  assert.equal(a.stars, 384)
  assert.equal(a.added, '2026-09-20')
  assert.equal(a.profile, 'web')

  // monorepo 子包：标题是 repo#packages/sub，身份要还原成仓库 URL
  assert.equal(b.name, 'dsh-web#packages/dsh-task-board')
  assert.equal(b.by, 'zhu1090093659')
  assert.equal(b.url, 'https://github.com/zhu1090093659/dsh-web')
  assert.equal(normalizeRepoUrl(b.url), 'zhu1090093659/dsh-web')

  assert.deepEqual(cats.map((c) => c.id), ['all', 'session', 'ui'])
  assert.equal(cats[0].count, 4400)

  // 分类 chip 不能被卡片属性误当成分类计数
  assert.equal(cats.find((c) => c.id === 'ui').count, 761)
})

test('parseSite: data-cmd 取最后一个（第一个是市场自己的推广按钮）', () => {
  const { plugins } = parseSite(SITE_HTML)
  assert.equal(plugins[0].cmd, 'dsh plugin --profile web add billion-context')
  assert.equal(plugins[0].source, 'billion-context', '取第一个会变成所有插件都装 dshmarket')
  assert.equal(plugins[1].source, '@linxin666/dsh-client-ui-task-board')
})

test('parseSite: 旧版标记（class=item / .by / GitHub 链接）仍兼容', () => {
  const { plugins } = parseSite(LEGACY_HTML)
  assert.equal(plugins.length, 1)
  assert.equal(plugins[0].name, 'dsh-theme-x')
  assert.equal(plugins[0].by, 'foo')
  assert.equal(plugins[0].url, 'https://github.com/foo/dsh-theme-x')
  assert.equal(plugins[0].stars, 1234)
  assert.equal(plugins[0].source, 'github:foo/dsh-theme-x')
})

test('parseSite: 没有 data-cat 的 <li> 不会被误收', () => {
  const { plugins } = parseSite('<ul><li class="card"><h3><a href="/x/">x</a></h3></li></ul>')
  assert.equal(plugins.length, 0)
})

test('siteCatalogToCatalog: 静态 JSON 目录映射成卡片形状', () => {
  const { plugins, cats } = siteCatalogToCatalog(siteCatalogJson(), 'zh')
  assert.equal(plugins.length, 3)
  assert.equal(plugins[0].name, 'billion-context')
  assert.equal(plugins[0].by, 'ranxianglei')
  assert.equal(plugins[0].url, 'https://github.com/ranxianglei/billion-context')
  assert.equal(plugins[0].stars, 384)
  assert.equal(plugins[0].added, '2026-09-20')
  assert.equal(plugins[2].source, 'github:foo/dsh-theme-x')
  assert.equal(cats[0].id, 'all')
  assert.equal(cats.find((c) => c.id === 'ui').label, 'UI 增强')
  assert.equal(cats.find((c) => c.id === 'ui').count, 1)
})

test('降级：plugins.json 报错时用静态 JSON 目录（不再塌缩）', async () => {
  mockFetch({
    'plugins.json': new Error('HTTP 502'),
    'catalog.json': { json: siteCatalogJson() },
    '/zh/': { text: SITE_HTML },
  })
  const out = await loadOnlineCatalog('zh')
  assert.equal(out.plugins.length, 3, '权威源失败必须回落到全量静态目录，而不是只剩推荐列表')
  assert.equal(out.plugins[0].name, 'billion-context')
})

test('降级：plugins.json 返回空目录时同样视为失败（守卫只看该源原始 payload）', async () => {
  mockFetch({
    'plugins.json': { json: { plugins: [], categories: {} } },
    'catalog.json': { json: siteCatalogJson() },
    '/zh/': { text: SITE_HTML },
  })
  const out = await loadOnlineCatalog('zh')
  assert.equal(out.plugins.length, 3)
})

test('降级：两个 JSON 源都失败时退回静态页解析（修复后不再是 0 条）', async () => {
  const calls = mockFetch({
    'plugins.json': new Error('HTTP 502'),
    'catalog.json': new Error('HTTP 404'),
    '/zh/': { text: SITE_HTML },
  })
  const out = await loadOnlineCatalog('zh')
  assert.equal(out.plugins.length, 2)
  assert.ok(calls.includes('https://awesome-dsh-plugin.com/zh/'))
})

test('降级：权威源挂起时，宽限窗口后用已就绪的静态目录（不串行等满两轮超时）', async () => {
  mockFetch({
    'plugins.json': 'hang',
    'catalog.json': { json: siteCatalogJson() },
    '/zh/': { text: SITE_HTML },
  })
  const t0 = Date.now()
  const out = await loadOnlineCatalog('zh')
  const ms = Date.now() - t0
  assert.equal(out.plugins.length, 3)
  assert.ok(ms < 8000, '最坏路径应是一次超时预算级别，而不是 10s + 10s 串行，实测 ' + ms + 'ms')
})

test('降级：全部在线源失败时用离线快照（source=snapshot）', async () => {
  mockFetch({
    'plugins.json': new Error('HTTP 502'),
    'catalog.json': new Error('HTTP 502'),
    '/zh/': new Error('HTTP 502'),
  })
  const out = await loadCatalog('zh')
  assert.equal(out.source, 'snapshot')
  assert.ok(out.plugins.length > 0, '快照仍应给出目录')
})

test('loadCatalog: 在线成功时 source=live 并写入缓存', async () => {
  mockFetch({
    'plugins.json': {
      json: {
        plugins: [{
          name: 'dsh-pet', owner: 'ysyyhhh', url: 'https://github.com/ysyyhhh/dsh-pet',
          category: 'ui', description: { zh: '宠物插件' },
          install: 'dsh plugin --profile web add github:ysyyhhh/dsh-pet', stars: 1, added: '2026-08-15',
        }],
        categories: { ui: { zh: 'UI 增强', en: 'UI Enhancements' } },
      },
    },
    'catalog.json': { json: siteCatalogJson() },
    '/zh/': { text: SITE_HTML },
  })
  const first = await loadCatalog('en')
  assert.equal(first.source, 'live')
  assert.equal(first.plugins[0].name, 'dsh-pet')
  const second = await loadCatalog('en')
  assert.equal(second.source, 'cache')
})
