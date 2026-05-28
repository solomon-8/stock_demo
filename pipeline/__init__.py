"""数据管线（子项目 B）。

中国 A 股历史行情 -> 复权 -> 脱敏 -> 指标 -> 切关卡 -> 导出关卡包 JSON。

模块（职责单一、可独立测试）：
- fetcher      : 抓日 K 行情 + 股本/流通股 + ST/退市/停牌状态（akshare/baostock）。断点续采 + 限流重试。
- adjuster     : 后复权。
- anonymizer   : 去名称/代码/真实日期 -> 相对日序，仅留契约字段。
- indicators   : MA5/10/20、MACD、RSI、换手率、量比、区间高低。
- level_builder: 切 30~60 日窗口（revealDays=10），写真实 halt/st/delist 事件，打 difficulty/outcomeTags。
- exporter     : 产出与 src/types/contract.ts 完全一致的 LevelPack JSON + index.json。

产出严格符合 src/types/contract.ts 中的 LevelPack / LevelIndex。
脱敏校验：关卡包中不得包含任何可还原股票真实身份的字段（名称、代码、绝对日期）。
"""

__all__ = [
    "fetcher",
    "adjuster",
    "anonymizer",
    "indicators",
    "level_builder",
    "exporter",
    "models",
]
