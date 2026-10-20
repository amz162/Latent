#!/usr/bin/env python3
"""Latent.pk — Generate extended mock company results with variable year ranges.

Per-company FY start (different lengths to match user's spec of "some have 8 years,
some have 5 years"):
  • ENGRO, HUBC, LUCK, PSO: 8 years (FY19-FY26)
  • MEBL, OGDC, PPL: 7 years (FY20-FY26)
  • SYS: 6 years (FY21-FY26)

All end at Q4 FY26 (current year per system date 2026-10-18).
"""
import json
from pathlib import Path

# Per-company base parameters
COMPANIES = {
    "ENGRO": {
        "company": "Engro Corporation Limited",
        "fy_start": 19,  # FY19-FY26 = 8 years
        "base_revenue": 55000, "base_profit": 4500, "base_eps": 8.5,
        "rev_growth": 0.12, "profit_growth": 0.18,
        "gross_margin_base": 20, "net_margin_base": 8,
        "final_dps": 22, "interim_dps_history": [0, 0, 12, 10],
        "quarter_notes": {
            1: "Off-season — fertilizer volumes muted at fiscal year start",
            2: "Rabi season peak — urea offtake strong, volumes surge",
            3: "Interim dividend declared; DAP prices supportive, momentum continues",
            4: "Final results — full-year recap; final dividend declared",
        },
    },
    "HUBC": {
        "company": "Hub Power Company Limited",
        "fy_start": 19,  # FY19-FY26 = 8 years
        "base_revenue": 38000, "base_profit": 6500, "base_eps": 5.0,
        "rev_growth": 0.08, "profit_growth": 0.10,
        "gross_margin_base": 36, "net_margin_base": 17,
        "final_dps": 11, "interim_dps_history": [0, 7, 0, 4],
        "quarter_notes": {
            1: "Plant utilization steady; PKR depreciation tailwind at year start",
            2: "Interim dividend; PIB receivables booked, cash flow strong",
            3: "Thar coal ramp-up; Narowal outage impact on margins",
            4: "Full-year recap; final dividend; CPEC expansion updates",
        },
    },
    "LUCK": {
        "company": "Lucky Cement Limited",
        "fy_start": 19,  # FY19-FY26 = 8 years
        "base_revenue": 42000, "base_profit": 3200, "base_eps": 8.0,
        "rev_growth": 0.10, "profit_growth": 0.15,
        "gross_margin_base": 26, "net_margin_base": 8,
        "final_dps": 15, "interim_dps_history": [0, 0, 0, 0],
        "quarter_notes": {
            1: "Construction season starts slow; coal prices volatile at year start",
            2: "Domestic demand + exports; margin pressure from input costs",
            3: "Coal ease; margin recovery begins, dispatches pick up",
            4: "Full-year recap; capacity expansion progress; final dividend",
        },
    },
    "SYS": {
        "company": "Systems Limited",
        "fy_start": 21,  # FY21-FY26 = 6 years (newer listing with less history)
        "base_revenue": 8500, "base_profit": 1200, "base_eps": 2.5,
        "rev_growth": 0.22, "profit_growth": 0.25,
        "gross_margin_base": 30, "net_margin_base": 14,
        "final_dps": 8, "interim_dps_history": [0, 5, 0, 0],
        "quarter_notes": {
            1: "New US client onboarded; ARR growth momentum at year start",
            2: "Interim dividend; acquisitions considered, deal pipeline strong",
            3: "MLOps acquisition; AI service line launch, R&D investments",
            4: "Full-year recap; FY revenue milestone; final dividend",
        },
    },
    "MEBL": {
        "company": "Meezan Bank Limited",
        "fy_start": 20,  # FY20-FY26 = 7 years
        "base_revenue": 18000, "base_profit": 3800, "base_eps": 3.5,
        "rev_growth": 0.20, "profit_growth": 0.22,
        "gross_margin_base": 38, "net_margin_base": 21,
        "final_dps": 5, "interim_dps_history": [0, 0, 3, 0],
        "quarter_notes": {
            1: "NIM expansion; ADR improvement at year start",
            2: "Islamic deposits crossed milestones; Casa ratio strong",
            3: "Interim dividend; ADR best-in-class; asset quality stable",
            4: "Full-year recap; bonus shares declared; final dividend",
        },
    },
    "PSO": {
        "company": "Pakistan State Oil Company Limited",
        "fy_start": 19,  # FY19-FY26 = 8 years
        "base_revenue": 600000, "base_profit": 4000, "base_eps": 8.0,
        "rev_growth": 0.05, "profit_growth": -0.05,
        "gross_margin_base": 4, "net_margin_base": 0.6,
        "final_dps": 10, "interim_dps_history": [0, 0, 0, 0],
        "quarter_notes": {
            1: "Inventory losses on falling crude; circular debt receivables",
            2: "Government cleared receivables; liquidity relief, refinancing",
            3: "Inventory gains on rising crude; margins recover modestly",
            4: "Final dividend; receivables still elevated; year-end recap",
        },
    },
    "OGDC": {
        "company": "Oil & Gas Development Co. Ltd",
        "fy_start": 20,  # FY20-FY26 = 7 years
        "base_revenue": 75000, "base_profit": 24000, "base_eps": 5.6,
        "rev_growth": 0.07, "profit_growth": 0.12,
        "gross_margin_base": 35, "net_margin_base": 32,
        "final_dps": 5, "interim_dps_history": [0, 0, 4, 0],
        "quarter_notes": {
            1: "Rupee depreciation tailwind; oil prices steady at year start",
            2: "Kunnar field ramp-up; exploration uplift; reserve additions",
            3: "Interim dividend; PIB income booking; gas production higher",
            4: "Final dividend; full-year recap; reserves replacement ratio update",
        },
    },
    "PPL": {
        "company": "Pakistan Petroleum Limited",
        "fy_start": 20,  # FY20-FY26 = 7 years
        "base_revenue": 50000, "base_profit": 14000, "base_eps": 5.0,
        "rev_growth": 0.06, "profit_growth": 0.10,
        "gross_margin_base": 33, "net_margin_base": 28,
        "final_dps": 4, "interim_dps_history": [0, 0, 3, 0],
        "quarter_notes": {
            1: "Sui field decline; exploration push at year start",
            2: "Randanishig field onstream; new wells coming online",
            3: "Interim dividend; exploration write-backs; reserve additions",
            4: "Final dividend; reserves replacement ratio; year-end recap",
        },
    },
}

records = []
for symbol, cfg in COMPANIES.items():
    fy_start = cfg["fy_start"]
    # FY26 = year 26 (Jul 2025 - Jun 2026, current fiscal year per system date 2026-10-18)
    years_range = list(range(fy_start, 27))  # FY19-FY26 inclusive
    for fy_idx, fy in enumerate(years_range):
        for q in [1, 2, 3, 4]:
            year_growth_mult = (1 + cfg["rev_growth"]) ** fy_idx
            profit_year_mult = (1 + cfg["profit_growth"]) ** fy_idx
            seasonal_mult = {1: 0.92, 2: 1.02, 3: 1.0, 4: 1.06}[q]
            profit_seasonal_mult = {1: 0.85, 2: 1.05, 3: 1.0, 4: 1.10}[q]

            revenue = int(cfg["base_revenue"] * year_growth_mult * seasonal_mult)
            profit = int(cfg["base_profit"] * profit_year_mult * profit_seasonal_mult)
            eps = round(cfg["base_eps"] * profit_year_mult * profit_seasonal_mult, 2)

            if fy_idx == 0:
                rev_yoy = cfg["rev_growth"] * 100 * (1 + (q - 2) * 0.05)
                prof_yoy = cfg["profit_growth"] * 100 * (1 + (q - 2) * 0.08)
            else:
                rev_yoy = cfg["rev_growth"] * 100 + (fy_idx * 1.5) + ((q - 2) * 2)
                prof_yoy = cfg["profit_growth"] * 100 + (fy_idx * 2) + ((q - 2) * 3)

            rev_yoy = round(rev_yoy, 1)
            prof_yoy = round(prof_yoy, 1)
            eps_yoy = round(prof_yoy + (q - 2) * 1.5, 1)

            gross_margin = round(cfg["gross_margin_base"] + (fy_idx * 0.5) + ((q - 2) * 0.3), 1)
            net_margin = round(cfg["net_margin_base"] + (fy_idx * 0.4) + ((q - 2) * 0.2), 1)

            # DPS logic
            if q == 4:
                dps = cfg["final_dps"]
                payout = round(dps / max(eps, 0.1) * 100, 0)
            elif q == 3 and cfg["interim_dps_history"][2] > 0:
                dps = cfg["interim_dps_history"][2]
                payout = round(dps / max(eps, 0.1) * 100, 0)
            elif q == 2 and cfg["interim_dps_history"][1] > 0:
                dps = cfg["interim_dps_history"][1]
                payout = round(dps / max(eps, 0.1) * 100, 0)
            else:
                dps = 0
                payout = 0

            notes = cfg["quarter_notes"][q]

            # Period end date
            # FY = Jul(prev_year) - Jun(this_year)
            # Q1 = Jul-Sep, ends Sep 30 of (year-1)
            # Q2 = Oct-Dec, ends Dec 31 of (year-1)
            # Q3 = Jan-Mar, ends Mar 31 of year
            # Q4 = Apr-Jun, ends Jun 30 of year
            yr = 2000 + fy
            if q == 1:
                period_end = f"{yr - 1:04d}-09-30"
            elif q == 2:
                period_end = f"{yr - 1:04d}-12-31"
            elif q == 3:
                period_end = f"{yr:04d}-03-31"
            else:  # q == 4
                period_end = f"{yr:04d}-06-30"

            records.append({
                "symbol": symbol,
                "company": cfg["company"],
                "period": f"Q{q} FY{fy}",
                "periodEnd": period_end,
                "metrics": {
                    "revenue": revenue,
                    "profitAfterTax": profit,
                    "eps": eps,
                    "revenueYoYGrowth": rev_yoy,
                    "profitYoYGrowth": prof_yoy,
                    "epsYoYGrowth": eps_yoy,
                    "grossMargin": gross_margin,
                    "netMargin": net_margin,
                    "dividendPerShare": dps,
                    "dividendPayoutRatio": payout,
                },
                "notes": notes,
                "quarter": q,  # 1-4 (used by generalized summary)
            })

# Save
out_path = Path("data/mock_company_results_5y.json")
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(records, indent=2))

print(f"Generated {len(records)} quarterly records")
print(f"Per-company breakdown:")
from collections import Counter
counts = Counter(r["symbol"] for r in records)
for sym, count in counts.items():
    cfg = COMPANIES[sym]
    print(f"  {sym}: {count} quarters (FY{cfg['fy_start']}-FY26 = {count // 4} years)")
print(f"\nSaved: {out_path}")
