#!/usr/bin/env python3
"""
Merge existing XGBoost predictions (from data/ml_predictions.json) into
the new multi-model predictions file (data/ml_predictions_multi.json).

The existing XGBoost predictions have a slightly different schema — we map them
to the unified multi-model schema so all 4 trained models are in one file.
"""

import json
from pathlib import Path
import pandas as pd

EXISTING_PATH = Path("data/ml_predictions.json")
MULTI_PATH = Path("data/ml_predictions_multi.json")
OUTPUT_PATH = Path("data/ml_predictions_multi.json")  # overwrite

def main():
    if not EXISTING_PATH.exists():
        print("ERROR: existing ml_predictions.json not found. Run scripts/train_xgboost.py first.")
        return
    if not MULTI_PATH.exists():
        print("ERROR: ml_predictions_multi.json not found. Run scripts/train_multi_models.py first.")
        return

    existing = json.loads(EXISTING_PATH.read_text())
    multi = json.loads(MULTI_PATH.read_text())

    # Convert existing XGBoost predictions to unified schema
    xgb_predictions = {}
    for symbol, pred in existing.get("predictions", {}).items():
        # Existing schema: direction, confidence, entryPrice, targetPrice, stopLoss, model_probability_up, latest_features
        # Unified schema: direction, signal, confidence, model_probability_up, currentPrice, predictedPrice, expectedMovePct, latest_features
        proba_up = pred.get("model_probability_up", 0.5)
        current_price = pred.get("entryPrice", 0)
        # Derive predicted price from probability
        expected_move_pct = (proba_up - 0.5) * 2 * 5  # ±5%
        predicted_price = current_price * (1 + expected_move_pct / 100)

        # Determine signal from direction + confidence
        direction = pred.get("direction", "LONG")
        confidence = pred.get("confidence", 50)
        if direction == "LONG":
            signal = "BUY" if confidence >= 55 else "HOLD"
        else:
            signal = "SELL" if confidence >= 55 else "HOLD"

        xgb_predictions[symbol] = {
            "direction": direction,
            "signal": signal,
            "confidence": confidence,
            "model_probability_up": proba_up,
            "currentPrice": current_price,
            "predictedPrice": round(predicted_price, 2),
            "expectedMovePct": round(expected_move_pct, 2),
            "latest_features": pred.get("latest_features", {}),
        }

    # Add XGBoost to the multi-model file
    multi["models"]["XGBoost"] = {
        "version": "1.0.0",
        "trained_at": existing.get("trained_at", pd.Timestamp.now().isoformat()),
        "metrics": existing.get("metrics", {}),
        "predictions": xgb_predictions,
        "trained": True,
        "features": 19,
        "training_rows": 2741,
        "note": "Trained via scripts/train_xgboost.py — predictions merged from existing file",
    }

    # Save
    OUTPUT_PATH.write_text(json.dumps(multi, indent=2))
    print(f"Merged XGBoost into multi-model predictions: {OUTPUT_PATH}")
    print(f"Trained models now: {sum(1 for m in multi['models'].values() if m.get('trained'))}")
    print(f"  - XGBoost: {len(xgb_predictions)} stocks")
    for model_name in ["LightGBM", "CatBoost", "RandomForest"]:
        if model_name in multi["models"] and multi["models"][model_name].get("trained"):
            preds = multi["models"][model_name].get("predictions", {})
            print(f"  - {model_name}: {len(preds)} stocks")

if __name__ == "__main__":
    main()
