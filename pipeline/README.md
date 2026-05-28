# 数据管线（子项目 B）

中国 A 股历史行情 → 后复权 → 脱敏 → 指标预计算 → 切关卡 → 导出关卡包 JSON。

产出严格符合 `src/types/contract.ts` 中的 `LevelPack` / `LevelIndex`。
**脱敏铁律**：关卡包中不得包含任何可还原股票真实身份的字段（名称 / 代码 / 绝对日期）。

## 模块（职责单一、可独立单测）

| 模块 | 文件 | 职责 |
|---|---|---|
| fetcher | `fetcher.py` | 抓日 K 行情 + 股本/流通股 + ST/退市/停牌状态（baostock 主，akshare 可选）。断点续采（按 code 缓存）+ 限流（最小间隔）+ 指数退避重试。提供 `MockFetcher` 离线读样本。 |
| adjuster | `adjuster.py` | 后复权：以序列首日因子为基准累乘，消除除权跳空；量不复权；停牌日价格冻结。 |
| anonymizer | `anonymizer.py` | 去名称/代码/真实日期 → 相对日序 `day`；仅投影契约字段；`assert_anonymized` 递归脱敏断言。 |
| indicators | `indicators.py` | MA5/10/20、MACD(DIF/DEA/MACD)、RSI(14)、换手率、量比、区间高低/涨跌幅。口径对齐前端种子脚本。 |
| level_builder | `level_builder.py` | 切 30~60 日窗口（`revealDays=10`）；检测真实 halt/st/delist 事件并归零到相对日序；打 difficulty/outcomeTags；生成 `reveal.story`。 |
| exporter | `exporter.py` | dataclass → 契约 JSON（丢弃 None 的 optional 字段）；脱敏断言；写关卡文件 + `index.json`。 |
| models | `models.py` | 采集层（含身份）与契约层（脱敏后）数据模型。 |

## 运行

### 离线（无外网，推荐先跑通）

```bash
python3 -m pipeline --mock
```

读 `pipeline/sample_data/` 下的小样本，端到端产出关卡包到
`src/assets/levels/generated/`（**子目录**，不覆盖前端种子 `level_*.json` / `index.json`）。

### 真实采集（需 `pip install -r requirements.txt` + 外网）

```bash
python3 -m pipeline \
  --codes sh.600000,sz.000001 \
  --start 2015-01-01 --end 2023-12-31 \
  --cache-dir .cache_fetch       # 断点续采缓存目录（可选）
```

参数：`--out-subdir`（输出子目录，默认 `generated`）、`--seed`（可复现随机种子）、`--levels-dir`（输出根，默认 `src/assets/levels`）。

> 本任务不做全量抓取；真实采集代码完整可用，但建议小批量分批跑。

### 测试

```bash
python3 -m pytest pipeline/tests/ -q
```

全部用例不依赖外网（走 `MockFetcher` + 内置样本），可离线跑通。沙箱下 `conftest.py` 会自动把临时目录指到仓库内。

## 关键实现说明

### 后复权（adjuster）
后复权以序列起点为基准，向后用复权因子比例 `f_i / f_first` 缩放价格，消除除权除息造成的"台阶式"假跌，使整段 K 线连续可比。成交量不复权。停牌日（`tradable=false`）价格冻结为前一交易日收盘、`volume=0`，复权后仍保持冻结一致性。样本无复权因子时退化为恒等（价格即原始价）。

### 脱敏（anonymizer）
- 真实日期 → 相对日序 `day`（从 0 起、连续）。
- 仅保留契约 `DayBar` 白名单字段，绝不输出 `date/code/name/symbol/...`。
- `exporter` 序列化前调用 `assert_anonymized` 递归校验；pytest 另对产出 JSON 文本做"无身份字段"断言。
- `reveal.story` 按契约**允许**含真实代号（仅结局复盘揭示，游戏过程不暴露），但本管线模板默认不写入真实代码。

### 换手率口径
`换手率% = 当日成交量 / 流通股本 × 100`（流通股本口径，A 股惯例）。流通股本缺失时该日 `turnover` 为 `None`（序列化时省略）。停牌日换手率与量比记为 0（量能枯竭，与前端种子观感一致）。

### 量比口径
`量比 = 当日成交量 / 过去 5 日平均成交量`；不足 5 个前置日返回 `None`；均量为 0 时返回 `None` 防除零。

### 事件检测与标签（level_builder）
- `halt`：连续 `tradable=false` 段；复牌首日 `resumeDay = endDay+1`，**落在窗口内才记**，否则为超长停牌（本局不复牌，省略 `resumeDay`，打 `long-halt`）。
- `st`：`is_st` 段；`startDay` 为首个 ST 日，`endDay` 到窗口末；ST 日 `priceLimit=0.05`。
- `delist`：`is_delisted` 段；持仓归零由**前端引擎依据 delist 事件结算**（管线只标事件，价格本身受 ±5% 限幅逼近地板）。
- outcomeTags：`surge/crash/flat/normal-halt/long-halt/st/delisted`，按区间涨跌幅 + 事件优先级推断；difficulty ∈ `easy/normal/hard`。

## 离线样本

`pipeline/sample_data/*.csv` + `*.meta.json` 为**采集层**小样本（故意含真实日期/代码/名称，模拟真实抓取结果），脱敏由管线负责，最终产出不含身份字段。
重新生成：`python3 pipeline/sample_data/_gen_samples.py`。
样本覆盖：涨 / 跌 / 横盘 / 普通停牌(复牌) / 超长停牌 / ST / 退市。

## 与前端契约一致性

- `DayBar` / `MarketEvent` / `LevelPack` / `LevelIndexEntry` 字段名、语义、optional 处理（None → 省略）均对齐 `src/types/contract.ts`。
- `revealDays=10`、`startCash=100000`、`totalDays ∈ [30,60]`、`days.length == totalDays`、`day` 连续从 0、OHLC 不变式（`low ≤ open/close ≤ high`）、停牌日 `tradable=false` 且 `volume=0`、ST/退市 `priceLimit=0.05`、不限制时省略 `priceLimit` —— 均由 `test_exporter_e2e.py` 断言。
