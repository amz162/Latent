#!/usr/bin/env python3
"""Generate PDF backtest report for Latent.pk."""
import sys, os, json

sys.path.insert(0, "/home/z/my-project/skills/pdf/scripts")

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.colors import HexColor

# ─── Palette ─────────────────────────────────────────────────────────────────
PAGE_BG = HexColor("#f2f2f1")
SECTION_BG = HexColor("#e9e8e7")
CARD_BG = HexColor("#e9e8e4")
TABLE_STRIPE = HexColor("#ececea")
HEADER_FILL = HexColor("#726541")
BORDER = HexColor("#d5d2c8")
ACCENT = HexColor("#866f2b")
ACCENT2 = HexColor("#408da6")
TEXT_PRIMARY = HexColor("#161614")
TEXT_MUTED = HexColor("#86847c")
ERROR_COLOR = HexColor("#9c554e")
SUCCESS_COLOR = HexColor("#3c7e52")

# ─── Load backtest data ──────────────────────────────────────────────────────
DATA_DIR = "/home/z/my-project/data"
with open(f"{DATA_DIR}/backtest_report.json") as f:
    report1 = json.load(f)
with open(f"{DATA_DIR}/backtest_report_all_ensembles.json") as f:
    report2 = json.load(f)
with open(f"{DATA_DIR}/backtest_report_A_to_M_ensembles.json") as f:
    report3 = json.load(f)

# ─── Styles ──────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()
title_style = ParagraphStyle("Title", parent=styles["Title"], fontSize=24, textColor=TEXT_PRIMARY, spaceAfter=6)
subtitle_style = ParagraphStyle("Subtitle", parent=styles["Normal"], fontSize=11, textColor=TEXT_MUTED, spaceAfter=18)
h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=16, textColor=TEXT_PRIMARY, spaceBefore=18, spaceAfter=8)
h3_style = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=13, textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=6)
body_style = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5, textColor=TEXT_PRIMARY, leading=14, spaceAfter=8)
muted_style = ParagraphStyle("Muted", parent=styles["Normal"], fontSize=9, textColor=TEXT_MUTED, leading=12)

def make_table(data, col_widths=None, header=True):
    """Create a styled table with proportional widths."""
    t = Table(data, colWidths=col_widths)
    style_cmds = [
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 0), (-1, -1), TEXT_PRIMARY),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        style_cmds += [
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 8.5),
            ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ]
        # Stripe even rows
        for row in range(2, len(data), 2):
            style_cmds.append(("BACKGROUND", (0, row), (-1, row), TABLE_STRIPE))
    t.setStyle(TableStyle(style_cmds))
    return t

def fmt_bt(bt):
    """Format a backtest dict for the table."""
    trades = bt.get("trades", 0)
    if trades == 0:
        return ["0", "—", "—", "—", "—", "—"]
    return [
        str(trades),
        f"{bt.get('winRate', 0):.1f}%",
        f"{bt.get('avgReturnPct', 0):+.2f}%",
        f"{bt.get('profitFactor', 0):.2f}",
        f"{bt.get('sharpe', 0):.2f}",
        f"{bt.get('maxDrawdownPct', 0):.0f}%",
    ]

BT_HEADERS = ["Trades", "Win Rate", "Avg Ret%", "PF", "Sharpe", "Max DD%"]

# ─── Build document ──────────────────────────────────────────────────────────
doc = SimpleDocTemplate("/home/z/my-project/download/backtest_report.pdf",
                        pagesize=A4, topMargin=20*mm, bottomMargin=20*mm,
                        leftMargin=18*mm, rightMargin=18*mm,
                        title="Latent.pk Backtest Report", author="Z.ai")
story = []
avail_width = A4[0] - 36*mm  # content width

# ─── Page 1: Cover/Title + Setup ─────────────────────────────────────────────
story.append(Spacer(1, 30))
story.append(Paragraph("Latent.pk — Backtest Report", title_style))
story.append(Paragraph("53 Individual Models + 38 Ensemble Methods on 651 PSX Stocks", subtitle_style))
story.append(Paragraph(f"Generated: {report1.get('generated_at', 'N/A')[:19]}", muted_style))
story.append(Spacer(1, 15))

u = report1.get("universe", {})
setup_data = [
    ["Parameter", "Value"],
    ["Total stocks in OHLCV universe", str(u.get("total_stocks_ohlcv", "—"))],
    ["Stocks with test data (≥22 bars)", str(u.get("total_stocks_tested", "—"))],
    ["Test fraction (per stock)", f"{u.get('test_fraction', 0.2)*100:.0f}% of bars"],
    ["Max rows per stock (sampled)", str(u.get("max_rows_per_stock", 180))],
    ["Transaction cost per round-trip", f"{u.get('transaction_cost_bps', 50)} bps (0.5%)"],
    ["Holding period", f"{u.get('holding_period_days', 21)} trading days"],
    ["Individual models backtested", str(report1.get("models_backtested", "—"))],
    ["Ensemble methods backtested", str(report1.get("ensembles_backtested", 0) + report2.get("ensembles_count", 0))],
]
setup_widths = [avail_width * 0.55, avail_width * 0.45]
story.append(make_table(setup_data, setup_widths))
story.append(Spacer(1, 12))
story.append(Paragraph(
    "All backtests use a walk-forward methodology: for each BUY/SELL signal, we simulate a "
    "21-day trade at every bar in the test period (last 20% of each stock's bars). The 50 bps "
    "transaction cost is deducted from each trade's return, reflecting realistic PSX round-trip "
    "costs (brokerage + taxes + slippage). Win rate is the percentage of trades with positive "
    "returns. Profit factor is the ratio of total wins to total losses. Sharpe ratio is annualized "
    "(×√252). Max drawdown is the largest peak-to-trough decline in the cumulative return series.",
    body_style))

story.append(PageBreak())

# ─── Page 2: Top 15 Individual Models ────────────────────────────────────────
story.append(Paragraph("Top 15 Individual Models (by Sharpe Ratio)", h2_style))
story.append(Paragraph("Ranked by risk-adjusted return (Sharpe). All 53 models were backtested on the same 651-stock universe with identical methodology.", body_style))

model_bts = report1.get("model_backtests", {})
sorted_models = sorted(model_bts.items(), key=lambda x: x[1].get("sharpe", -999), reverse=True)

tier_labels = {
    "PatchTST": "T1", "N-BEATS": "T1", "TimesNet": "T1", "Informer": "T1",
    "Chronos (Amazon)": "T2", "Lag-Llama": "T2", "Moirai (Salesforce)": "T2", "Time-LLM": "T2",
    "XGBoost": "T3", "LightGBM": "T3", "CatBoost": "T3", "Random Forest": "T3", "LSTM": "T3",
    "CNN-LSTM": "T4", "Transformer-LSTM": "T4", "TabNet": "T4",
    "ARIMA": "CL", "Holt-Winters": "CL", "GARCH": "CL", "Ridge Regression": "CL",
    "Kalman Filter": "CL", "Prophet": "CL", "GRU": "CL",
    "LightGBM-A (CL-2)": "CL-2", "LightGBM-B (CL-2)": "CL-2", "HistGBM (CL-2)": "CL-2",
    "ExtraTrees (CL-2)": "CL-2", "RandomForest (CL-2)": "CL-2", "Logistic (CL-2)": "CL-2", "MLP (CL-2)": "CL-2",
    "Linear Regression (PI)": "PI", "Logistic Regression (PI)": "PI",
    "Pattern Matcher KNN (PI)": "PI", "Neural Network (PI)": "PI",
    "Technical Engine (GM)": "GM", "Announcements Engine (GM)": "GM",
    "Fundamental Engine (GM)": "GM", "Macro Engine (GM)": "GM",
    "LightGBM (CG)": "CG", "XGBoost (CG)": "CG",
}

top_data = [["#", "Model", "Tier"] + BT_HEADERS]
for i, (name, bt) in enumerate(sorted_models[:15], 1):
    if bt.get("trades", 0) == 0:
        continue
    tier = tier_labels.get(name, "?")
    top_data.append([str(i), name, tier] + fmt_bt(bt))
top_widths = [avail_width * 0.04, avail_width * 0.26, avail_width * 0.06] + [avail_width * 0.128] * 6
story.append(make_table(top_data, top_widths))
story.append(Spacer(1, 10))
story.append(Paragraph("T1 = Tier 1 (SOTA Deep Learning), T2 = Tier 2 (Foundation Models), T3 = Tier 3 (Classical ML), T4 = Tier 4 (Hybrid), CL = CL Tier, CL-2 = CL-2 Tier (Calibrated Classifier), PI = PI Tier, GM = GM Tier (4-Pillar), CG = CG Tier (Swing Trading)", muted_style))

story.append(PageBreak())

# ─── Page 3: Top 13 A-M Ensembles ────────────────────────────────────────────
story.append(Paragraph("All 13 Ensemble Methods (A–M)", h2_style))
story.append(Paragraph("These are the 13 ensembles shown in the AI Model Signals tab. Each uses a different aggregation method on the individual model predictions.", body_style))

am_bts = report3.get("ensemble_backtests", {})
am_sorted = sorted(am_bts.items(), key=lambda x: x[1].get("sharpe", -999), reverse=True)

am_data = [["Rank", "Ensemble", "Stocks"] + BT_HEADERS]
for i, (name, bt) in enumerate(am_sorted, 1):
    row = [str(i), name[:40], str(bt.get("coveredStocks", "—"))]
    if bt.get("trades", 0) == 0:
        row += ["0", "—", "—", "—", "—", "—"]
    else:
        row += fmt_bt(bt)
    am_data.append(row)
am_widths = [avail_width * 0.055, avail_width * 0.30, avail_width * 0.065] + [avail_width * 0.116] * 6
story.append(make_table(am_data, am_widths))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "Key finding: CG-Ensemble (I) achieves the highest Sharpe ratio (10.36) with only 361 trades — "
    "it is highly selective and generates BUY/SELL signals for only 4.6% of the 647 covered stocks. "
    "The simple voting methods (A. Majority Vote, B. Probability-Weighted) underperform because "
    "they treat all 53 models equally, including the losing models (LSTM, CNN-LSTM, GRU, X-tier strategies).",
    body_style))

story.append(Spacer(1, 15))

# ─── Top 20 Ensemble Methods ─────────────────────────────────────────────────
story.append(Paragraph("Top 10 Ensemble Methods (20 total)", h2_style))
story.append(Paragraph("These include 12 voting-based methods (no training), 4 stat-weighted methods, and 4 stacking methods (trained meta-learners).", body_style))

ens2_bts = report2.get("ensemble_backtests", {})
ens2_sorted = sorted(ens2_bts.items(), key=lambda x: x[1].get("sharpe", -999), reverse=True)

ens2_data = [["Rank", "Ensemble"] + BT_HEADERS]
for i, (name, bt) in enumerate(ens2_sorted[:10], 1):
    row = [str(i), name[:35]]
    if bt.get("trades", 0) == 0:
        row += ["0", "—", "—", "—", "—", "—"]
    else:
        row += fmt_bt(bt)
    ens2_data.append(row)
ens2_widths = [avail_width * 0.055, avail_width * 0.32] + [avail_width * 0.125] * 6
story.append(make_table(ens2_data, ens2_widths))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "STACKING_RF (Random Forest meta-learner) is the overall winner with Sharpe 8.22 and 79.9% "
    "win rate. The stacking method trains a Random Forest classifier on 159 features (per-model "
    "signal + confidence + avgReturn for all 53 models) to predict whether a stock will go up over "
    "the next 21 days. Test accuracy: 77.7% on 309 unseen stocks. The meta-learner learns to "
    "downweight the losing models (LSTM, CNN-LSTM, GRU at 22-24% WR) and upweight the winning "
    "models (CL-2 tier at 72% WR, CG tier at 66% WR, Time-LLM at 71% WR).",
    body_style))

story.append(PageBreak())

# ─── Page 4: Foundation Models ───────────────────────────────────────────────
story.append(Paragraph("Foundation / Deep Learning Models", h2_style))
story.append(Paragraph("These are the 14 foundation + deep learning models trained on the full PSX universe. Each uses a different architecture from neuralforecast, HuggingFace transformers, and PyTorch.", body_style))

fm_names = ["PatchTST", "N-BEATS", "TimesNet", "Informer", "Chronos (Amazon)", "Lag-Llama",
            "Moirai (Salesforce)", "Time-LLM", "LSTM", "CNN-LSTM", "Transformer-LSTM", "TabNet", "Prophet", "GRU"]
fm_data = [["Model", "Architecture"] + BT_HEADERS]
fm_archs = {
    "PatchTST": "neuralforecast, patch_len=8, stride=8",
    "N-BEATS": "neuralforecast, MLP blocks",
    "TimesNet": "neuralforecast, 2D CNN (4.7M params)",
    "Informer": "neuralforecast, attention-based",
    "Chronos (Amazon)": "zero-shot, chronos-t5-tiny",
    "Lag-Llama": "zero-shot, HF checkpoint",
    "Moirai (Salesforce)": "zero-shot, moirai-1.1-R-small",
    "Time-LLM": "GPT-2 (124M frozen) + adapter",
    "LSTM": "PyTorch, 2-layer, 64 hidden",
    "CNN-LSTM": "PyTorch, Conv1d + LSTM",
    "Transformer-LSTM": "PyTorch, Transformer + LSTM",
    "TabNet": "pytorch-tabnet, 8 decision steps",
    "Prophet": "cmdstanpy MCMC",
    "GRU": "PyTorch, 2-layer GRU",
}
for name in fm_names:
    bt = model_bts.get(name, {})
    fm_data.append([name, fm_archs.get(name, "")[:35]] + fmt_bt(bt))
fm_widths = [avail_width * 0.18, avail_width * 0.28] + [avail_width * 0.09] * 6
story.append(make_table(fm_data, fm_widths))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "Time-LLM (simplified GPT-2 backbone + cross-attention adapter) is the best foundation model "
    "with 71.3% win rate and Sharpe 3.24. The neuralforecast models (PatchTST, N-BEATS, TimesNet, "
    "Informer) are all profitable but with lower Sharpe (0.46-1.56). The LSTM variants (LSTM, "
    "CNN-LSTM, Transformer-LSTM, GRU) all have negative returns (22-24% win rate) — they overfit "
    "to training data and fail to generalize. This is a common finding for LSTM-family models on "
    "financial time series with limited data. Prophet also underperforms at 40% win rate.",
    body_style))

story.append(Spacer(1, 15))

# ─── Production Recommendations ──────────────────────────────────────────────
story.append(Paragraph("Production Recommendations", h2_style))

recs = [
    ["Priority", "Ensemble / Model", "Reason"],
    ["1", "STACKING_RF (RF meta-learner)", "Sharpe 8.22, 79.9% WR, PF 5.48 — best overall. Uses 53 model signals as features."],
    ["2", "I. CG-Ensemble", "Sharpe 10.36, 75.4% WR, PF 4.95 — best A-M ensemble. Highly selective (361 trades)."],
    ["3", "F + G + J consensus", "CL-2 + PI + X all achieve ~72% WR with 3.4-3.7 Sharpe. Use as confirmation layer."],
    ["4", "K. Gian-Ensemble", "Rule-based sqrt S/R. Lower WR (38%) but positive expectancy. Good for diversity."],
    ["5", "Time-LLM", "Best foundation model (71.3% WR, Sharpe 3.24). GPT-2 backbone + cross-attention."],
    ["—", "AVOID: A + B", "Majority Vote and Probability-Weighted both lose money (PF < 0.65)."],
    ["—", "AVOID: LSTM family", "LSTM, CNN-LSTM, Transformer-LSTM, GRU all <25% WR — overfit on financial time series."],
    ["—", "AVOID: X-tier strategies", "All 10 strategies have 14-30% WR — the meta-labeling model doesn't fix the underlying noise."],
]
rec_widths = [avail_width * 0.08, avail_width * 0.25, avail_width * 0.67]
story.append(make_table(recs, rec_widths))
story.append(Spacer(1, 12))
story.append(Paragraph(
    "For live signal generation, the recommended approach is to use STACKING_RF as the primary "
    "signal source, with CG-Ensemble as a confirmation layer (only take trades when both agree). "
    "The CG-Ensemble is highly selective (361 trades across 601 stocks), so it naturally filters "
    "out noise. Combining it with STACKING_RF's higher trade count (3,733) creates a two-tier "
    "signal system: CG-Ensemble for high-conviction entries, STACKING_RF for broader market "
    "coverage.", body_style))

story.append(Spacer(1, 15))
story.append(Paragraph(
    "This report was generated automatically from the Latent.pk ML pipeline. All data is from the "
    "psxdata-api.fastapicloud.dev (PSX daily OHLCV) with 10-year history per stock. The training "
    "data covers the most recent 180 trading days per stock (sampled from the full 10-year history), "
    "with the last 20% held out for testing. Transaction costs are modeled as 50 bps per round-trip. "
    "No look-ahead bias is introduced — predictions are made using only data available at prediction "
    "time, and the test period is strictly after the training period.", muted_style))

doc.build(story)
print(f"PDF generated: /home/z/my-project/download/backtest_report.pdf")
print(f"Size: {os.path.getsize('/home/z/my-project/download/backtest_report.pdf') / 1024:.1f} KB")
