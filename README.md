# Insu Lang Quick Check V4

直接把本文件夹内容放到 GitHub repo 根目录，Vercel 会自动部署。

## 现在就可以跑
AI 没有 API Key 也不影响评分。所有 Rule-Based 计算都在浏览器里完成。

## AI 之后才开
Vercel -> Settings -> Environment Variables：

- `GEMINI_API_KEY` = 你的 Google AI Studio API Key
- 可选 `GEMINI_MODEL` = `gemini-3.1-flash-lite`

保存后 Redeploy。AI 只在用户点「想了解为什么会得到这个评分」时调用。

## 核心 Rule
- Life = 家庭月生活费 × 12 × 10 + 剩余贷款 + RM50,000
- CI = 家庭月生活费 × 12 × 10 + 剩余贷款
- Accident = 与 Life 相同
- Medical 基础参考：Annual Limit ≥ RM1m；Room & Board ≥ RM300/day
- 流动现金只显示现金流缓冲，不从保障需求扣除
- 保障区间采用中间值估算
- > RM1m 的生活/贷款/保障会要求进一步填写实际数字（对应题目）
- 贷款或相关保障 > RM5m 时，相关项目提示 Full Review，不用 Quick Check 硬算

## Score
现有保障估值 ÷ Ideal Benchmark × 100，封顶 100。
- 80–100 基础较完整
- 60–79 建议检视
- 40–59 明显保障差距
- 0–39 优先关注

## 图片
这一版不依赖任何图片，所以你现在直接上传就能跑。
以后可在首页把右侧的 IL 品牌卡换成：
- Dr. Lawrence 真人专业照（首页信任）
- Insu Lang mascot / 卡通 Lawrence（工具、loading、AI explanation）
建议图片放进 `/images/`，之后再改 HTML 即可。

## V4.1 首页补回内容
- Google Reviews Elfsight widget
- 5 个 FAQ
- Dr. Lawrence 联系资料
- Instagram / Facebook / TikTok / 小红书 / 抖音社交入口
- 小红书与抖音使用独立 SVG 图标，不再用普通文字代替
