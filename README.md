# 匿名股神 · 股票模拟交易小游戏（MVP）

用**真实 A 股历史行情切片**作为关卡：你只看到一段匿名 K 线，逐日决策加仓 / 卖出 / 持有，体验暴涨的爽与停牌、ST、退市的痛。

- 平台：Web 优先（H5），技术栈 **Taro(React) + klinecharts**，后续可移植微信/抖音/小红书小程序与 Steam。
- 数据：**Python(baostock) 离线管线**抓取→后复权→脱敏→算指标→切关卡，产出静态关卡包；游戏纯前端读取，**无后端即可玩**。
- 玩法：单股一局；前 10 日展示，局长随机 30–60 日；每日一决策；滑条自由选量；停牌冻结 / 退市归零 / ST 限幅 / 超长停牌可一键跳复牌；结局复盘 + 与“全程持有不动”对比 + 事后揭盘真相。

> 完整设计见 [`docs/superpowers/specs/2026-05-29-stock-trading-game-design.md`](docs/superpowers/specs/2026-05-29-stock-trading-game-design.md)。

## 快速开始（玩起来）

```bash
# 1. 安装依赖（仓库存在 vite peer 冲突，需带 --legacy-peer-deps）
npm install --legacy-peer-deps

# 2. 本地开发预览（H5，浏览器打开提示的地址即可游玩）
npm run dev:h5

# 或：构建静态产物到 dist/，用任意静态服务器托管
npm run build:h5
```

## 开发与质量

```bash
npm test            # 游戏引擎 + 关卡加载器单元测试（71 例）
npm run smoke       # 真实浏览器冒烟：驱动 H5 产物跑完整一局并截图(/tmp/smoke-*.png)
                    # 需先 npm run build:h5，且本机装有 Google Chrome
npx tsc --noEmit    # 类型检查
```

## 数据管线（子项目 B）

```bash
# 离线 mock（无需外网，跑通端到端导出 + pytest）
python3 -m pipeline --mock
python3 -m pytest pipeline/tests -q        # 50 例

# 真实抓取 A 股（需 pip install baostock 且有外网）
python3 -m pipeline --out-subdir generated_real --seed 20260529 \
  --start 2015-01-01 --end 2023-12-31 \
  --codes sh.600519,sz.000001,sh.601318   # 逗号分隔的 baostock 代码

# 抓取/新增关卡后，重建合并索引与加载器注册表：
node tools/build-levels.mjs
```

`tools/build-levels.mjs` 会扫描 `src/assets/levels/**/level_*.json`（合成种子 + 真实数据），
自动重建 `src/assets/levels/index.json` 与 `src/data/levelLoader.ts` 中的静态注册表，难度由结局标签推导，幂等可复跑。

## 项目结构

```
src/
  types/contract.ts      数据契约（A↔B 唯一接口）
  engine/                纯函数游戏引擎（状态机，零框架依赖，全单测）
  data/levelLoader.ts    关卡加载器 + 选关策略（注册表自动生成）
  components/            Chart(K线) / TradePanel(交易) / Result(复盘) 纯展示组件
  store/useGame.ts       游戏状态 hook（装配引擎 + 数据 + 视图）
  pages/index/           页面入口
  assets/levels/         关卡包：level_00xx(合成种子) + generated_real/(真实A股)
pipeline/                Python 数据管线（fetcher/adjuster/anonymizer/indicators/level_builder/exporter）
tools/                   gen-seed(合成关卡) / build-levels(合并) / smoke(浏览器冒烟)
```

## 当前进度

- ✅ 子项目 A：游戏引擎、Web 客户端、完整一局闭环（买卖/推进/事件/结算/复盘），浏览器实测可玩。
- ✅ 子项目 B：数据管线 + 真实 A 股关卡（出厂含 12 合成 + 25 真实 + 6 真实退市 = 43 关）。
  - 真实暴涨/暴跌/横盘/真实停牌（从历史 tradestatus 检测）+ 真实换手率（baostock turn）。
  - **6 个真实退市股关卡**（长生退/乐视退/康得退等，经 `pipeline.build_delisted` 取生命末期窗口、
    末日标记退市）——真实复现「看着曾经很美 → 停牌 → ST → 退市归零、永远无法翻身」的签名痛点。
- ⏭️ 后续（C/D/E）：账号/存档、排行榜/社交分享、小程序与 Steam 打包。

## 已知限制

- 真实退市关卡常以真实长期停牌开局（前 10 日 K 线冻结），需点「跳到复牌首日」进入退市整理期；
  属真实且戏剧化的硬核关卡（difficulty=hard），非缺陷。
- 部分蓝筹样本的「量比」依赖足够历史，窗口起始处可能为空（不影响游玩）。
- 小程序/Steam 仅保证技术栈不堵死移植，本期未实际打包。

### 抓取更多真实退市股关卡

```bash
python3 -m pipeline.build_delisted \
  --codes sz.002680,sz.300104,sz.002450,sh.600401,sh.600145,sz.000587
node tools/build-levels.mjs   # 重建索引与加载器注册表
```
