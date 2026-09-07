"""
train_model.py
----------------
Kya kaam karta hai:
1. flood_training.csv load karta hai
2. Data ko train/test mein split karta hai (80% train, 20% test)
3. Random Forest train karta hai (baseline/starting model)
4. XGBoost train karta hai (final/better model)
5. Dono ko evaluate karta hai — Precision, Recall, F1, ROC-AUC (sirf accuracy nahi!)
6. Best model ko flood_model.pkl mein save karta hai backend ke liye
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    precision_score, recall_score, f1_score,
    roc_auc_score, confusion_matrix, classification_report
)
import pickle

# ---- Step 1: Data load karo ----
df = pd.read_csv("flood_training.csv")

FEATURES = [
    "rainfall_1h", "rainfall_3h", "rainfall_24h",
    "humidity", "elevation", "slope",
    "soil_moisture", "river_distance"
]
TARGET = "flood"

X = df[FEATURES]
y = df[TARGET]

# ---- Step 2: Train/Test split ----
# stratify=y isliye use kiya taaki train aur test dono mein
# flood/no-flood ka ratio SAME rahe (warna model biased ho sakta hai)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

print(f"Train rows: {len(X_train)}, Test rows: {len(X_test)}")


def evaluate_model(name, model, X_test, y_test):
    """Ek helper function jo har model ke liye same metrics print kare"""
    preds = model.predict(X_test)
    probs = model.predict_proba(X_test)[:, 1]  # flood hone ki probability

    print(f"\n{'='*50}")
    print(f"MODEL: {name}")
    print(f"{'='*50}")
    print(f"Precision: {precision_score(y_test, preds):.3f}  (jab model 'flood' bole, kitni baar sahi hai)")
    print(f"Recall:    {recall_score(y_test, preds):.3f}  (asli floods mein se kitne pakde) <-- YE SABSE IMPORTANT")
    print(f"F1-score:  {f1_score(y_test, preds):.3f}  (precision+recall ka balance)")
    print(f"ROC-AUC:   {roc_auc_score(y_test, probs):.3f}  (0.5=random guess, 1.0=perfect)")
    print("\nConfusion Matrix:")
    cm = confusion_matrix(y_test, preds)
    print(f"                Predicted No-Flood | Predicted Flood")
    print(f"Actual No-Flood:      {cm[0][0]:4d}          |      {cm[0][1]:4d}   <- False Alarms")
    print(f"Actual Flood:         {cm[1][0]:4d}          |      {cm[1][1]:4d}   <- Correct Catches")
    print(f"                      ^^^^ MISSED FLOODS (sabse dangerous mistake)")
    return f1_score(y_test, preds)


# ---- Step 3: Random Forest (baseline) ----
rf_model = RandomForestClassifier(
    n_estimators=150,     # 150 decision trees banayega aur unka vote lega
    max_depth=10,         # zyada deep na jaye, warna overfit ho jayega
    random_state=42,
    class_weight="balanced"  # flood/no-flood imbalance ko handle karta hai
)
rf_model.fit(X_train, y_train)
rf_f1 = evaluate_model("Random Forest", rf_model, X_test, y_test)

# ---- Step 4: XGBoost (final model) ----
try:
    from xgboost import XGBClassifier
    xgb_model = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        eval_metric="logloss",
        random_state=42
    )
    xgb_model.fit(X_train, y_train)
    xgb_f1 = evaluate_model("XGBoost", xgb_model, X_test, y_test)

    # Jo better hai, wahi final model banega
    final_model = xgb_model if xgb_f1 >= rf_f1 else rf_model
    final_name = "XGBoost" if xgb_f1 >= rf_f1 else "Random Forest"
except ImportError:
    print("\n⚠️  xgboost installed nahi hai, sirf Random Forest use kar rahe hain")
    final_model = rf_model
    final_name = "Random Forest"

# ---- Step 5: Feature importance dikhao (explainability ke liye useful!) ----
print(f"\n{'='*50}")
print(f"FEATURE IMPORTANCE ({final_name}) — 'kaunsa factor sabse zyada matter karta hai'")
print(f"{'='*50}")
importances = pd.Series(final_model.feature_importances_, index=FEATURES)
importances = importances.sort_values(ascending=False)
for feat, imp in importances.items():
    bar = "█" * int(imp * 50)
    print(f"{feat:20s} {imp:.3f}  {bar}")

# ---- Step 5b: Threshold tuning — flood prediction mein RECALL zyada important hai ----
# Default threshold 0.5 hota hai, lekin flood ke case mein hum THODA LOWER
# threshold rakhte hain — taaki model zyada floods "pakde", chahe thodi
# zyada false alarms de. Missing a real flood is worse than a false alarm.
print(f"\n{'='*50}")
print("THRESHOLD TUNING — alag-alag threshold pe Recall kaisa badalta hai")
print(f"{'='*50}")
best_threshold = 0.5
for t in [0.5, 0.45, 0.4, 0.35, 0.3, 0.25]:
    probs_test = final_model.predict_proba(X_test)[:, 1]
    preds_t = (probs_test >= t).astype(int)
    r = recall_score(y_test, preds_t)
    p = precision_score(y_test, preds_t)
    print(f"threshold={t:.2f}  ->  Recall={r:.3f}  Precision={p:.3f}")

FINAL_THRESHOLD = 0.35  # is threshold ko backend mein use karenge
print(f"\n✅ Chosen threshold for deployment: {FINAL_THRESHOLD} (Recall ko priority di, "
      f"kyunki flood miss karna zyada costly hai)")

# ---- Step 6: Model save karo ----
with open("flood_model.pkl", "wb") as f:
    pickle.dump({
        "model": final_model,
        "features": FEATURES,
        "model_name": final_name,
        "threshold": FINAL_THRESHOLD
    }, f)

print(f"\n✅ Final model saved: flood_model.pkl (using {final_name}, threshold={FINAL_THRESHOLD})")
