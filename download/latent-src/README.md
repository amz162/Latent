# Latent.pk — AI-Driven PSX Investment Platform

**Turning "what stock should I buy" into "here's the plan to reach your goal."**

Latent.pk is a deep-analytical, AI-driven investment platform for the Pakistan Stock Exchange (PSX) built for salaried Pakistani investors who want exposure to PSX but lack the financial literacy or time to analyze it themselves.

This package contains the complete source code, trained ML model, Python training scripts, and the 14-slide investor pitch deck.

---

## What's in this package

```
latent-pk/
├── src/                          # Next.js 16 + TypeScript source
│   ├── app/                      # App Router pages + 18+ API routes
│   │   ├── api/
│   │   │   ├── psx/               # 12 AskAnalyst.com.pk proxy routes
│   │   │   ├── scrape/            # 2 Investify.pk scraper routes
│   │   │   ├── llm/               # 2 LLM endpoints (news + signal enrichment)
│   │   │   ├── ml/signal/[symbol] # XGBoost signal scaffold
│   │   │   ├── cron/check-tp-sl   # TP/SL monitoring endpoint
│   │   │   ├── portfolio/news-digest  # Per-stock news auto-interpretation
│   │   │   ├── onboarding, plan, execute, signals, track-record, stocks
│   │   ├── layout.tsx            # Root layout with Inter + JetBrains Mono + Noto Nastaliq Urdu
│   │   ├── globals.css          # Dark fintech premium theme
│   │   └── page.tsx             # Main entry, renders AppShell
│   ├── components/latent/        # 14 view components (Landing, Dashboard, 7 tabs, etc.)
│   ├── lib/latent/              # Core utilities (store, types, cache, i18n, etc.)
│   └── components/ui/           # shadcn/ui component library
│
├── scripts/                     # Python ML training pipeline
│   ├── fetch_ohlcv.py          # Fetches 2yr OHLCV from askanalyst.com.pk
│   └── train_xgboost.py        # Trains XGBoost on real PSX data, saves predictions
│
├── data/                        # Generated data files
│   ├── ohlcv/                   # 8 CSV files (one per stock, ~3,756 rows total)
│   └── ml_predictions.json      # XGBoost predictions consumed by Next.js
│
├── models/                      # Trained ML models
│   ├── xgboost_signal.json      # Trained XGBoost model (25KB)
│   └── feature_schema.json      # Model metadata + metrics
│
├── prisma/
│   └── schema.prisma            # User, RiskProfile, Plan, Trade models
│
├── public/                      # Static assets (logo, robots.txt)
│
├── deliverables/                # Investor pitch deck
│   ├── Latent_Pitch_Deck.pptx   # 14-slide deck (8.1MB)
│   └── slides/                  # HTML source for each slide
│
├── .env.example                 # Environment variables template
├── package.json                 # Dependencies + scripts
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json              # shadcn/ui config
├── Caddyfile                    # Gateway config
├── WORKLOG.md                   # Full development log
└── README.md                    # This file
```

---

## Quick start

### Prerequisites

- **Node.js 18+** (or Bun — recommended)
- **Python 3.10+** with pip (for ML training only — optional if you just want to run the app)
- **Git** (for cloning, optional)

### Install + run

```bash
# 1. Install dependencies
cd latent-pk
bun install   # or npm install

# 2. Set up the database
cp .env.example .env
bun run db:push   # creates SQLite DB at db/custom.db

# 3. (Optional) Refresh ML predictions
#    The data/ml_predictions.json file is already included, but to retrain:
python3 scripts/fetch_ohlcv.py     # fetches fresh OHLCV from askanalyst.com.pk
python3 scripts/train_xgboost.py  # retrains XGBoost, regenerates predictions

# 4. Start the dev server
bun run dev
# App at http://localhost:3000
```

### Production build

```bash
bun run build
bun run start
```

---

## Architecture

### Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | Prisma ORM + SQLite (swap to Postgres for prod) |
| State | Zustand (state + i18n + notifications + portfolio) |
| ML model | XGBoost (Python) trained on real PSX OHLCV |
| LLM | GLM-4-Plus via z-ai-web-dev-sdk (swappable to Ollama + Llama 3.2) |
| Cache | Redis-compatible (ioredis with ioredis-mock fallback) |
| Charts | recharts (real OHLCV from AskAnalyst.com.pk) |
| Fonts | Inter + JetBrains Mono + Noto Nastaliq Urdu (for Urdu RTL) |

### 7 tabs (all built)

1. **Fundamental News** — 3 sub-tabs (International/National, Company News, Company Results) + news link interpreter
2. **Technical Analysis** — real chart with 50/200-DMA + support/resistance + AI prediction
3. **Signal Section** — per-stock BUY/SELL/HOLD/ACCUMULATE from XGBoost + confidence + 3-call matrix
4. **Portfolio & Watchlist** — add/remove/reorder + P&L tracking + auto-news digest per stock
5. **Investment Strategy** — 4 goal options + allocation + risk-managed callout
6. **Dividends** — top dividend announcements sorted by yield
7. **Tracker** — signal tracker (win rate, ROI%) + portfolio tracker (P&L)

### Production architecture

```
AskAnalyst.com.pk API
        ↓
scripts/fetch_ohlcv.py (daily cron)
        ↓
data/ohlcv/*.csv (raw OHLCV, 8 stocks × 2 years)
        ↓
scripts/train_xgboost.py (daily retrain)
        ↓
models/xgboost_signal.json (trained model)
data/ml_predictions.json (cached predictions)
        ↓
Next.js /api/ml/signal/[symbol] (runtime reads JSON)
        ↓
Signal Section tab + Signal Detail view
                                ↓
                        /api/llm/explain-signal/[symbol]
                                ↓ (cached 1hr per symbol)
                                GLM-4-Plus generates rich layman analysis
                                ↓
                        Signal Detail panel renders
```

---

## ML model (real, not stub)

The XGBoost signal model is **trained on real PSX OHLCV data** from askanalyst.com.pk:

- **Training data**: 3,427 rows × 19 features × 8 stocks × 2 years
- **Features**: RSI(14), MACD/signal/hist, Bollinger width + %B, ATR(14), OBV change %, Price/SMA ratios (20/50/200-day), Volume/SMA(20), momentum returns (1d/7d/14d/30d), high-low range, candle body %, 14-day volatility
- **Labels**: did price rise ≥3% within 21 days? (binary)
- **Time-based 80/20 split** (last 20% held out for evaluation)
- **Conservative hyperparameters**: max_depth=3, min_child_weight=15, L1=1.0, L2=3.0, early stopping

**Honest metrics:**
- Accuracy: 54.7%
- Precision: 55.8%
- Recall: 88.0%
- F1: 68.3%
- ROC-AUC: 0.402 (worse than random — model is overfit to training regime)

The model is honest about uncertainty (most predictions show ~50% confidence). This is the difference between a stub and a real model — the stub claimed fake 78% confidence, the real model claims honest 50%.

### How to improve

1. **More data** — extend `STOCKS` in `scripts/fetch_ohlcv.py` to cover all 530+ KSE-100 names
2. **Walk-forward cross-validation** instead of single time-based split
3. **Regime-aware features** — KSE-100 trend, sector breadth, USD/PKR movement
4. **Per-stock models** when each has enough data
5. **Ensemble** — combine XGBoost with logistic regression + LLM sentiment

### Re-train (one command)

```bash
python3 scripts/fetch_ohlcv.py     # refresh OHLCV (2-3 min)
python3 scripts/train_xgboost.py  # retrain + regenerate predictions (~30 sec)
# App picks up new predictions automatically (no Next.js restart needed)
```

---

## LLM integration

### Current setup: GLM-4-Plus via z-ai-web-dev-sdk

Latent.pk uses **GLM-4-Plus** (Z.ai's open-weights model) for:
1. **News interpretation** — `/api/llm/interpret-news` (paste a URL, get structured impact analysis)
2. **Signal enrichment** — `/api/llm/explain-signal/[symbol]` (rich layman explanation of XGBoost output)
3. **Per-stock news digest** — `/api/portfolio/news-digest` (auto-fetches + interprets news for portfolio stocks)

GLM-4-Plus is **NOT ChatGPT or Claude** — it's Z.ai's model. GLM-4-9B is fully open-source on HuggingFace.

### Swap to self-hosted Ollama + Llama 3.2 (5-line change)

Each LLM endpoint has documented swap-in instructions. Example from `/api/llm/interpret-news/route.ts`:

```typescript
// Replace ZAI client init with:
const resp = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "llama3.2:3b",  // or mistral:7b, qwen2.5:7b
    messages: [...],
    stream: false,
    format: "json",
  }),
});
```

All prompts, parsing logic, caching, and UI integration stay identical — only the LLM call changes.

### Production Ollama setup

```bash
# On a GPU server (or 16+ core CPU with 32GB RAM):
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2:3b   # ~2GB download
# Run as systemd service for auto-restart
```

### LLM guardrails (system prompts)

The system prompts enforce:
- Output strict JSON only — no markdown, no commentary
- NEVER make BUY/SELL recommendations (XGBoost's job, not LLM's)
- Stick to PSX-listed stocks only
- Be conservative — if unsure, return "neutral" not "positive"/"negative"
- Use layman language — define any technical term in 1 short clause
- Reference PSX context (PKR amounts, SBP rate environment)
- Setup-specific risk factors, not generic stock-market risks

---

## Caching

### Dev (default): in-memory cache

When `REDIS_URL` env var is not set, the app uses `ioredis-mock` (in-memory). Works for single-instance dev only.

### Production: Redis

Set `REDIS_URL=redis://your-redis:6379` env var. All 3 LLM endpoints automatically switch to Redis. Multi-instance safe.

### Cache TTLs

- `/api/llm/explain-signal/[symbol]` — 1 hour per symbol
- `/api/llm/interpret-news` — 24 hours by content hash
- `/api/portfolio/news-digest` — 24 hours per symbol+news-item

---

## TP/SL notification system

### In-app polling

`AppNav` component polls `/api/cron/check-tp-sl` every 5 minutes while user is active. On TP/SL hit → fires a notification in the bell dropdown.

### External cron (production)

Set `CRON_SECRET` env var and call `/api/cron/check-tp-sl` with `Authorization: Bearer <secret>` header from:

**Vercel Cron** (in `vercel.json`):
```json
{
  "crons": [
    { "path": "/api/cron/check-tp-sl", "schedule": "*/5 4-12 * * 1-5" }
  ]
}
```

**GitHub Actions**: scheduled workflow with `curl -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://latent.pk/api/cron/check-tp-sl`

Schedule: every 5 minutes, 4-12 UTC (Mon-Fri) = 9am-5pm PKT (PSX session hours).

---

## Multi-language support

- **English** (default)
- **Roman Urdu** (Urdu in Latin script)
- **Urdu** (Nastaliq script, RTL layout direction)

Language toggle in nav bar. Selection persisted to localStorage. `LanguageDirSync` component applies `dir` attribute + font family on `<html>` element.

The i18n dictionary (`src/lib/latent/i18n.ts`) covers nav labels, common terms, signal directions, news categories, portfolio actions. Full Urdu translation of every UI string can be added iteratively.

---

## AskAnalyst.com.pk API integration

12 server-side proxy routes (bypass CORS):

| Route | Upstream |
|---|---|
| `GET /api/psx/companies` | `/api/companylistwithsymbols` |
| `GET /api/psx/news/[symbol]` | `/api/news/{symbol}` |
| `GET /api/psx/reports/[symbol]` | `/api/publishreports/{symbol}` |
| `GET /api/psx/technical/[symbol]` | `/api/technicalchart/day/{from}/{to}/{symbol}` |
| `GET /api/psx/financials/[symbol]` | `/api/financialstatement/{symbol}` |
| `GET /api/psx/ratio/[symbol]` | `/api/rationew/{symbol}` |
| `GET /api/psx/filings/[symbol]` | `/api/filings/{symbol}` |
| `GET /api/psx/valuation/[symbol]` | `/api/generatevaluation2/{symbol}` |
| `GET /api/psx/iss/[symbol]` | `/api/iss/{symbol}` |
| `GET /api/psx/bss/[symbol]` | `/api/bss/{symbol}` |
| `GET /api/psx/ksechart/[symbol]` | `/api/ksechartnew/{symbol}` |
| `GET /api/psx/settlement/[symbol]` | `/api/settlementchartnew/{symbol}` |

---

## Investify.pk scrapers

2 server-side scrapers using cheerio:

| Route | Source | Schedule |
|---|---|---|
| `GET /api/scrape/news` | https://www.investify.pk/news | Mon-Fri 09:00-17:00 PKT |
| `GET /api/scrape/announcements` | https://www.investify.pk/announcements | Mon-Fri 09:00-17:00 PKT |

Pre-session scrape at 08:55 PKT captures overnight news. Continuous scrape every 5 min during session catches live updates. Post-session scrape at 17:00 PKT updates track record.

News items are classified (national/international/market/company) and deduplicated by URL.

---

## Investor pitch deck

The 14-slide pitch deck is included in `deliverables/Latent_Pitch_Deck.pptx`. HTML source for each slide is in `deliverables/slides/` (open any `slide_*.html` in a browser to view).

Slides:
1. Cover
2. Vision / Hook (Pakistan's moment)
3. Problem 1 — Participation gap (stats grid)
4. Problem 2 — Literacy & time (signal-to-noise diagram)
5. Problem 3 — Existing solutions (3-column comparison)
6. Market Size — TAM/SAM/SOM
7. Why Now — 5 tailwinds (bento grid)
8. Solution — 3 pillars
9. Product Flow — 4-step timeline
10. Comparison — feature matrix
11. Business Model — 3 revenue cards + unit economics
12. Roadmap & Traction — 4-quarter timeline
13. The Ask — $1.5M + use-of-funds
14. Closing — contact

---

## Production deployment checklist

1. **Set environment variables** (see `.env.example`):
   - `DATABASE_URL` — Postgres connection string for prod
   - `REDIS_URL` — Redis connection string for shared cache
   - `CRON_SECRET` — random string for cron endpoint auth

2. **Provision GPU server for self-hosted LLM** (optional — if you want to swap GLM-4 for Ollama):
   - Install Ollama + pull Llama 3.2 3B
   - Update LLM endpoints per documented swap-in (5-line change each)

3. **Configure Vercel Cron** for TP/SL monitoring:
   - `*/5 4-12 * * 1-5` → `/api/cron/check-tp-sl`

4. **Extend XGBoost training to all 530+ KSE-100 stocks**:
   - Edit `STOCKS` in `scripts/fetch_ohlcv.py`
   - Run `python3 scripts/fetch_ohlcv.py && python3 scripts/train_xgboost.py`

5. **Wire real broker API** when you have credentials (Singular / Arif Habib / Foundation):
   - Replace stub in `/api/execute/route.ts` with real broker integration

6. **Get SECP RIA license** before any paid signal goes live:
   - Engage a securities lawyer (Vellani & Vellani, Mandlwala & Zavar, KBRL)
   - File for RIA licensing — application itself can take 6-12 months
   - Until licensed, operate as research/education subscription (not specific signals)

---

## Honest assessment

This MVP demonstrates:
- ✅ Real XGBoost model trained on real PSX OHLCV (54.7% accuracy, ROC-AUC 0.402 — honest metrics)
- ✅ Real GLM-4 LLM integration for news + signal interpretation (swappable to self-hosted Ollama)
- ✅ 12 AskAnalyst.com.pk API proxies + 2 Investify.pk scrapers
- ✅ 7 fully-built tabs with real data + LLM enrichment
- ✅ Real charts (recharts) wired to live OHLCV
- ✅ Urdu RTL support
- ✅ TP/SL notification cron with in-app polling + external cron documentation
- ✅ Redis-compatible caching (production-ready)
- ✅ 14-slide investor pitch deck

What it doesn't have:
- ❌ Real broker API integration (pending your credentials)
- ❌ Real SECP RIA license (legal prerequisite, not code)
- ❌ XGBoost model trained on 530+ KSE-100 stocks (currently 8 stocks, 2 years of data)
- ❌ Full Urdu translation of every UI string (i18n dictionary covers core terms only)
- ❌ Real cron scheduling (endpoint exists + documented; needs Vercel Cron or GitHub Actions config)

**Past performance does not guarantee future returns. Trading on PSX carries risk. Latent.pk is not yet licensed by SECP as a Registered Investment Advisor — do not execute real trades based on demo signals.**

---

## License

Proprietary. All rights reserved. © 2026 Latent.pk.

## Contact

- Email: founders@latent.pk
- Web: latent.pk/investors
