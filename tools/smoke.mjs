// Headless browser smoke test: serves dist/, drives the H5 build with system Chrome,
// collects console/runtime errors, plays a full game loop, screenshots.
// Run: node tools/smoke.mjs
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.resolve(__dirname, '../dist')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 8731

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json',
}

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    if (urlPath === '/') urlPath = '/index.html'
    let file = path.join(DIST, urlPath)
    if (!existsSync(file)) file = path.join(DIST, 'index.html') // SPA fallback
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch (e) {
    res.writeHead(500); res.end(String(e))
  }
})

const log = (...a) => console.log(...a)

async function main() {
  await new Promise((r) => server.listen(PORT, r))
  log(`[smoke] serving ${DIST} at http://localhost:${PORT}`)

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=420,900'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 })

  const consoleErrors = []
  const pageErrors = []
  const failedReqs = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('requestfailed', (r) => failedReqs.push(`${r.url()} ${r.failure()?.errorText}`))

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2500)) // let level load + chart init

  // Click the deepest element whose trimmed text equals `label` (Taro H5 attaches
  // onClick to the rendered View/Button element, so a DOM .click() fires the handler).
  const clickByText = (label) => page.evaluate((label) => {
    const all = [...document.querySelectorAll('*')]
    const matches = all.filter((el) => {
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
      return t === label
    })
    // deepest = the one with fewest matching descendants
    const target = matches.sort((a, b) => b.compareDocumentPosition(a) & 16 ? -1 : 1)[matches.length - 1] || matches[0]
    if (target) { target.click(); return true }
    return false
  }, label)

  const snap = async () => page.evaluate(() => {
    const txt = (document.querySelector('#app')?.innerText || '').replace(/\s+/g, ' ').trim()
    return {
      appTextLen: txt.length,
      appTextHead: txt.slice(0, 240),
      hasCanvas: !!document.querySelector('canvas'),
    }
  })

  const initial = await snap()
  await page.screenshot({ path: '/tmp/smoke-gameplay.png' }).catch(() => {})
  log('[smoke] initial render:', JSON.stringify(initial, null, 2))

  // Try one buy at 50% to exercise the trade path, then drive day-by-day to the result.
  let boughtOk = false
  try {
    await clickByText('买入')
    await new Promise((r) => setTimeout(r, 200))
    const afterBuy = await page.evaluate(() => (document.querySelector('#app')?.innerText || ''))
    boughtOk = !/持仓市值 0\.00/.test(afterBuy) // holdings became non-zero
  } catch { /* ignore */ }

  let rounds = 0, reachedResult = false, clickErr = null
  for (let i = 0; i < 80; i++) {
    const cur = await page.evaluate(() => (document.querySelector('#app')?.innerText || ''))
    if (/再来一局/.test(cur)) { reachedResult = true; break }
    try {
      const skipped = cur.includes('跳到复牌') ? await clickByText('跳到复牌首日') : false
      const clicked = skipped || await clickByText('下一日')
      if (clicked) rounds++
      await new Promise((r) => setTimeout(r, 110))
    } catch (e) { clickErr = String(e); break }
  }

  const final = await snap()
  await page.screenshot({ path: '/tmp/smoke-final.png' }).catch(() => {})
  log('[smoke] after driving game:', JSON.stringify({ boughtOk, rounds, reachedResult, finalHead: final.appTextHead }, null, 2))

  await browser.close()
  server.close()

  const ok = pageErrors.length === 0 && initial.appTextLen > 0 && initial.hasCanvas
  log('\n========== SMOKE REPORT ==========')
  log('renderedNonEmpty :', initial.appTextLen > 0)
  log('canvasPresent    :', initial.hasCanvas)
  log('pageErrors       :', pageErrors.length, pageErrors.slice(0, 5))
  log('consoleErrors    :', consoleErrors.length, consoleErrors.slice(0, 5))
  log('failedRequests   :', failedReqs.length, failedReqs.slice(0, 5))
  log('gameRoundsClicked:', rounds)
  log('reachedResult    :', reachedResult)
  log('clickError       :', clickErr)
  log('screenshot       : /tmp/smoke-final.png')
  log('VERDICT          :', ok ? 'PASS' : 'FAIL')
  log('==================================')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error('[smoke] fatal', e); server.close(); process.exit(2) })
