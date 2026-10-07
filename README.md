# dsh-peak-price-panel

DeepSeek Harness 主界面信息面板插件：**峰谷价格 + 余额 + 充值**。

## 功能

- **峰谷时段**：按北京时间显示当前处于高峰（工作日 9:00–12:00、14:00–18:00）还是低谷，带下次切换倒计时；**周末与中国法定节假日全天按低谷价计费**（周末规则 2026-08-23 起，节假日自 0.3.0 起）。临近切换（默认提前 30 分钟，可配置）弹出横幅——临近高峰提示涨价、临近低谷提示半价。
- **单价展示**：侧边栏卡片实时显示当前时段所配置模型（默认价格表全部模型）的输出单价（高峰全价 / 低谷半价）。
- **过期提醒**：价格表数据版本超过 `staleAfterDays`（默认 30 天）未更新时，侧边栏「输出单价」标题变黄并提示「价格表可能过期」。
- **余额**：轮询 `GET https://api.deepseek.com/user/balance`，显示总余额，按三档阈值（默认 50 / 20 / 5，可配置）变色并预警。
- **充值**：侧边栏充值按钮，低余额（告急/极低档）时按钮红色脉冲联动、余额数字变红加粗。

## 数据与代码解耦（v0.2.0 起）

价格表与峰谷时段是**数据配置**，不再硬编码在代码里：

- 内置默认值在 `lib/pricing.js`（`DEFAULT_MODEL_PRICES` / `DEFAULT_PEAK_WINDOWS` / `DEFAULT_HOLIDAYS`），仅作兜底。
- 实际生效值来自设置层 `prices` / `peakWindows` / `holidays`，两处可改：
  1. **Settings → Plugins → Cost panel** 里的「价格表 JSON」文本框（实时生效，无需重装）；
  2. `cordis.patch.yml` 的 `config.prices` / `config.peakWindows` / `config.holidays`（base 层，改后需重启 web 生效）。
- **DeepSeek 调价时改配置即可，无需改代码、无需发版。**

## 安装

```sh
# 从 npm 安装（推荐）
dsh plugin --profile web add dsh-peak-price-panel

# 或从本地目录安装
dsh plugin --profile web add <本目录路径>
```

API key 从设置里的 `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）解析：优先取同名环境变量，未设置时回退 DSH 凭据库，无需重复填写。

## 数据说明

- 内置数据版本 `2026-09-10`（V4.1-Flash 发布日，官方降价）：现行峰价（¥/1M tokens）`deepseek-flash` = 命中 0.04 / 未命中 2 / 输出 8，`deepseek-v4-pro` = 0.30 / 9 / 27（计费未变）；谷价 = 峰价一半。旧名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 已下线并路由到 V4.1-Flash、按 Flash 价计费（故表中同价保留）。
- **法定节假日**：官方高峰时段为「周一至周五 9–12/14–18，**不含中国法定节假日**」，且调休上班的周末同样按空闲计费。插件按「周末 ∪ 法定节假日」判定空闲日；节假日列表源自 [国务院办公厅关于2026年部分节假日安排的通知](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)（国办发明电〔2025〕7号）。**每年 11 月国务院公布次年安排后需更新 `holidays`**；`/cost-panel/status` 的 `holidayCovered` 为 `false` 表示当前年份未被覆盖。
- `currency` 仅影响余额的币种过滤与显示符号，不换算单价。
- 调价后更新 `prices`（以及需要时更新 `peakWindows`、`scheduleVersion`、`holidays`），都在配置层，不在代码层。

## 配置项（Settings → Plugins → Cost panel）

| 键 | 默认 | 说明 |
|---|---|---|
| warnThreshold | 50 | 提醒阈值（¥） |
| criticalThreshold | 20 | 告警阈值（¥，充值按钮联动） |
| extremeThreshold | 5 | 极低阈值（¥，充值按钮红色脉冲 + 余额红字加粗） |
| refreshSeconds | 60 | 余额轮询间隔（秒） |
| peakLeadSeconds | 1800 | 峰谷切换提前提示（秒） |
| currency | CNY | CNY / USD |
| apiKeyEnv | DEEPSEEK_API_KEY | API key 凭据名 |
| staleAfterDays | 30 | 价格表超过 N 天未更新（相对 scheduleVersion）时标黄提醒 |
| models | （空） | 显示哪些模型的单价；留空 = 价格表里全部模型 |
| prices | 内置 4 条目 | 单价表 `{模型:{cacheHit,cacheMiss,output}}`（¥/1M tokens，峰价）；含 `deepseek-flash`、`deepseek-v4-pro` 及两个 legacy Flash 名 |
| scheduleVersion | 2026-09-10 | 价格表数据版本戳（YYYY-MM-DD，用于过期判断） |
| peakWindows | [[9,12],[14,18]] | 工作日高峰时段 `[startHour,endHour)` |
| holidays | 2026 年法定节假日 | 中国法定节假日（北京时间 `YYYY-MM-DD` 数组），全天按低谷计费；每年 11 月更新 |

## 验证

```sh
node --test test/*.mjs
```
