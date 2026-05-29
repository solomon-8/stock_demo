// Headless browser smoke test: serves dist/, drives the H5 build with system Chrome,
// collects console/runtime errors, plays a full game loop across all three screens,
// and screenshots each. Run: node tools/smoke.mjs
//
// Flow (adapted to the new start screen):
//   load home → /tmp/ui-home.png
//   click "开始挑战" → game (chart) → /tmp/ui-game.png
//   buy 50% → drive day-by-day (skip-to-resume on halt) → result → /tmp/ui-result.png
// Any pageError fails the run.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

  // Click the deepest element whose trimmed, space-collapsed text CONTAINS `label`.
  // Taro H5 attaches onClick to the rendered View/Button DOM node, so a native
  // .click() fires the handler. We match by `contains` so decorative glyphs in the
  // label (e.g. "▶  开始挑战") still resolve to the right node.
  const clickByText = (label) => page.evaluate((label) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const all = [...document.querySelectorAll('*')]
    const matches = all.filter((el) => norm(el.innerText || el.textContent).includes(label))
    if (!matches.length) return false
    // deepest = the node with the shortest matching text (fewest extra descendants)
    matches.sort((a, b) => norm(a.innerText || a.textContent).length - norm(b.innerText || b.textContent).length)
    matches[0].click()
    return true
  }, label)

  const appText = () => page.evaluate(() => (document.querySelector('#app')?.innerText || ''))

  const snap = async () => page.evaluate(() => {
    const txt = (document.querySelector('#app')?.innerText || '').replace(/\s+/g, ' ').trim()
    return {
      appTextLen: txt.length,
      appTextHead: txt.slice(0, 200),
      hasCanvas: !!document.querySelector('canvas'),
    }
  })

  // ---- Screen 1: home ----------------------------------------------------
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 30000 })
  await sleep(800)
  const home = await snap()
  const homeText = await appText()
  const homeOk = /开始挑战/.test(homeText) && !home.hasCanvas
  await page.screenshot({ path: '/tmp/ui-home.png' }).catch(() => {})
  log('[smoke] HOME:', JSON.stringify({ ...home, homeOk }, null, 2))

  // ---- Transition: start the game ---------------------------------------
  const startClicked = await clickByText('开始挑战')
  // wait for the chart canvas to mount (level load + klinecharts init)
  let canvasUp = false
  for (let i = 0; i < 40; i++) {
    await sleep(150)
    canvasUp = await page.evaluate(() => !!document.querySelector('canvas'))
    if (canvasUp) break
  }
  await sleep(600) // settle chart paint

  // ---- Screen 2: game ----------------------------------------------------
  const game = await snap()
  const gameOk = startClicked && game.hasCanvas && game.appTextLen > 0
  await page.screenshot({ path: '/tmp/ui-game.png' }).catch(() => {})
  log('[smoke] GAME:', JSON.stringify({ ...game, startClicked, gameOk }, null, 2))

  // ---- Play: buy 50%, then drive day-by-day to the result ----------------
  // The trade panel now has a "买入"/"卖出" segment header AND a primary action
  // button labelled "买入 +N 股". Click the action button (it contains "股"),
  // not the segment toggle, so a real trade fires.
  let boughtOk = false
  try {
    const clicked = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const all = [...document.querySelectorAll('*')]
      const cands = all.filter((el) => {
        const t = norm(el.innerText || el.textContent)
        return /^买入\s*[+＋]?\s*[\d,]+\s*股$/.test(t)
      })
      if (!cands.length) return false
      cands.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length)
      cands[0].click()
      return true
    })
    await sleep(200)
    const afterBuy = (await appText()).replace(/\s+/g, ' ')
    boughtOk = clicked && !/持仓\s*0\s*股/.test(afterBuy)
  } catch { /* ignore */ }

  let rounds = 0, reachedResult = false, clickErr = null
  for (let i = 0; i < 120; i++) {
    const cur = await appText()
    if (/再来一局/.test(cur)) { reachedResult = true; break }
    try {
      const skipped = cur.includes('跳到复牌') ? await clickByText('跳到复牌') : false
      const clicked = skipped || await clickByText('下一日')
      if (clicked) rounds++
      else break // nothing actionable left
      await sleep(90)
    } catch (e) { clickErr = String(e); break }
  }

  // ---- Screen 3: result --------------------------------------------------
  await sleep(400)
  const result = await snap()
  const resultOk = reachedResult && /再来一局/.test(await appText())
  await page.screenshot({ path: '/tmp/ui-result.png' }).catch(() => {})
  log('[smoke] RESULT:', JSON.stringify({ ...result, boughtOk, rounds, reachedResult, resultOk }, null, 2))

  await browser.close()
  server.close()

  const ok =
    pageErrors.length === 0 &&
    homeOk &&
    gameOk &&
    resultOk

  log('\n========== SMOKE REPORT ==========')
  log('HOME   page PASS :', homeOk, '(开始挑战 present, no canvas)')
  log('GAME   page PASS :', gameOk, '(canvas mounted after start)')
  log('RESULT page PASS :', resultOk, '(再来一局 reached)')
  log('boughtOk         :', boughtOk)
  log('gameRoundsClicked:', rounds)
  log('pageErrors       :', pageErrors.length, pageErrors.slice(0, 5))
  log('consoleErrors    :', consoleErrors.length, consoleErrors.slice(0, 5))
  log('failedRequests   :', failedReqs.length, failedReqs.slice(0, 5))
  log('clickError       :', clickErr)
  log('screenshots      : /tmp/ui-home.png  /tmp/ui-game.png  /tmp/ui-result.png')
  log('VERDICT          :', ok ? 'PASS' : 'FAIL')
  log('==================================')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error('[smoke] fatal', e); server.close(); process.exit(2) })
