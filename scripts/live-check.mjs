// 精选目录加载的在线自检（需要网络，手动运行；不参与 `npm test`）：
//   node scripts/live-check.mjs
// 对照 issue #1 的四条路径，打印条数 / 耗时 / source，用于人工确认修复效果。
import { parseSite, loadOnlineCatalog, loadCatalog } from '../lib/host.js'

const realFetch = globalThis.fetch

function timeit(label, fn) {
  return Promise.resolve().then(fn).then((r) => {
    console.log(label, JSON.stringify(r))
    return r
  })
}

// 1) 静态页解析（站点 2026-09 版）
const html = await (await realFetch('https://awesome-dsh-plugin.com/zh/', { redirect: 'follow' })).text()
const page = parseSite(html)
console.log('parseSite(live html) -> plugins =', page.plugins.length, 'cats =', page.cats.length)
if (page.plugins[0]) {
  console.log('  sample:', JSON.stringify({
    name: page.plugins[0].name, by: page.plugins[0].by, url: page.plugins[0].url,
    source: page.plugins[0].source, stars: page.plugins[0].stars, added: page.plugins[0].added,
  }))
}

// 2) 两个在线源都正常
await timeit('loadOnlineCatalog(live, cold) ->', async () => {
  const t0 = Date.now()
  const out = await loadOnlineCatalog('zh')
  return { ms: Date.now() - t0, plugins: out ? out.plugins.length : 0, cats: out ? out.cats.length : 0 }
})

// 3) 回归：plugins.json 故障（HTTP 层拒绝）时必须拿到全量静态目录
await timeit('loadOnlineCatalog(registry DOWN) ->', async () => {
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('plugins.json')) throw new Error('simulated registry outage')
    return realFetch(url, opts)
  }
  const t0 = Date.now()
  const out = await loadOnlineCatalog('zh')
  return { ms: Date.now() - t0, plugins: out ? out.plugins.length : 0, source0: out ? out.plugins[0].name : null }
})

// 4) 回归：两源全断 -> 快速降级到离线快照
await timeit('loadCatalog(both DOWN) ->', async () => {
  globalThis.fetch = async () => { throw new Error('simulated total outage') }
  const t0 = Date.now()
  const out = await loadCatalog('en')
  return { ms: Date.now() - t0, source: out.source, plugins: out.plugins.length }
})
globalThis.fetch = realFetch
