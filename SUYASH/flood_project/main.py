"""
main.py — FastAPI Backend
---------------------------
Kya kaam karta hai:
1. Startup pe flood_model.pkl load karta hai (ek baar, baar-baar nahi)
2. /predict endpoint — frontend se weather+terrain data leta hai, model se
   probability nikalta hai, risk-level + explanation ke saath wapas bhejta hai
3. /report endpoint — community verification feature (users apna ground-report
   bhej sakte hain: "yahan paani bhar gaya")
4. /reports endpoint — saare community reports wapas bhejta hai (map pe dikhane ke liye)

Chalane ka tareeka:
    pip install fastapi uvicorn scikit-learn pandas --break-system-packages
    uvicorn main:app --reload
Fir browser mein: http://127.0.0.1:8000/docs  (auto-generated API testing page)
"""

import pickle
from datetime import datetime
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from water_vision import analyze_water_level

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(title="Flash Flood Early Warning API")

# CORS: frontend (jo alag port pe chalega, jaise localhost:5500) ko backend
# se baat karne dene ke liye ye zaroori hai, warna browser block kar dega
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # hackathon ke liye sab allow, production mein specific rakhna
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Model load (ek hi baar, server start hote waqt — har request pe nahi,
# warna bahut slow ho jayega)
# ---------------------------------------------------------------------------
with open("flood_model.pkl", "rb") as f:
    saved = pickle.load(f)

MODEL = saved["model"]
FEATURES = saved["features"]
THRESHOLD = saved.get("threshold", 0.5)

# In-memory storage community reports ke liye (hackathon ke liye kaafi hai;
# real deployment mein PostgreSQL use karenge)
COMMUNITY_REPORTS = []

# In-memory storage user profiles ke liye — personalized vulnerability data
USER_PROFILES = []


# ---------------------------------------------------------------------------
# Request/Response schemas (Pydantic) — ye automatically input validate
# karta hai. Agar koi galat type ya missing field bheje, FastAPI khud
# hi clear error de dega.
# ---------------------------------------------------------------------------
class FloodPredictionRequest(BaseModel):
    latitude: float
    longitude: float
    rainfall_1h: float = Field(..., ge=0, description="Last 1 hour rainfall in mm")
    rainfall_3h: float = Field(..., ge=0)
    rainfall_24h: float = Field(..., ge=0)
    humidity: float = Field(..., ge=0, le=100)
    elevation: float = Field(..., description="meters")
    slope: float = Field(..., ge=0, le=90, description="degrees")
    soil_moisture: float = Field(..., ge=0, le=1)
    river_distance: float = Field(..., ge=0, description="meters from nearest river")
    location_name: Optional[str] = "Unknown"


class FloodPredictionResponse(BaseModel):
    location_name: str
    flood_probability: float
    risk_level: str
    warning_message: str
    top_contributing_factors: List[dict]


class CommunityReport(BaseModel):
    latitude: float
    longitude: float
    location_name: str
    water_level_description: str  # e.g. "ankle-deep", "knee-deep", "severe"
    reported_by: Optional[str] = "Anonymous"


class UserProfile(BaseModel):
    name: str
    location_name: str
    latitude: float
    longitude: float
    house_type: str          # "kaccha" or "pucca"
    floor: str                # "ground" or "upper" (1st floor and above)
    has_vulnerable_members: bool  # elderly, children, disabled, etc.


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
def get_risk_level(probability: float) -> str:
    """PDF mein diye gaye thresholds use kar rahe hain"""
    if probability < 0.30:
        return "LOW"
    elif probability < 0.60:
        return "MODERATE"
    elif probability < 0.80:
        return "HIGH"
    else:
        return "CRITICAL"


def get_warning_message(risk_level: str) -> str:
    messages = {
        "LOW": "Abhi koi khaas khatra nahi hai. Normal activities continue karein.",
        "MODERATE": "Halka risk hai. Mausam updates pe nazar rakhein.",
        "HIGH": "Flash flood ka risk hai. Low-lying areas aur river ke paas jaane se bachein.",
        "CRITICAL": "⚠️ CRITICAL FLOOD RISK! Turant surakshit, unchi jagah par chale jayein. "
                    "Nadi/nale ke paas bilkul na jayein."
    }
    return messages[risk_level]


def get_personalized_action(risk_level: str, profile: dict) -> str:
    """
    Unique feature: Generic alert ke bajaye, har profile ke hisaab se
    ALAG action-advice deta hai. Research batata hai generic warnings
    log ignore kar dete hain — personalized advice zyada asar karti hai.

    Logic:
    - Kaccha ghar + ground floor + vulnerable members = SABSE zyada risk pe hain,
      unhe sabse pehle aur sabse strong action lena chahiye
    - Pucca ghar + upper floor = apne ghar mein hi relatively safe reh sakte hain
    """
    if risk_level in ("LOW", "MODERATE"):
        return "Abhi ke liye koi special action ki zarurat nahi — bas updates dekhte rahein."

    is_high_vulnerability = (
        profile["house_type"] == "kaccha"
        or profile["floor"] == "ground"
        or profile["has_vulnerable_members"]
    )

    if risk_level == "HIGH":
        if is_high_vulnerability:
            return ("Aapka ghar/floor risk factors ke hisaab se zyada vulnerable hai. "
                    "Zaroori saaman aur documents ready rakhein, aur nearest safe/relative's "
                    "location plan karke rakhein.")
        return ("Aapka ghar relatively safe hai (pucca/upper floor), lekin phir bhi "
                "low-lying areas mein jaane se bachein aur updates pe nazar rakhein.")

    if risk_level == "CRITICAL":
        if is_high_vulnerability:
            return ("⚠️ AAPKE LIYE HIGH PRIORITY: Kaccha ghar/ground-floor/vulnerable members "
                    "ke karan aapko SABSE PEHLE evacuate karna chahiye. Turant nearest relief "
                    "shelter ki taraf nikal jayein.")
        return ("Aapka ghar (pucca/upper floor) thoda zyada surakshit hai, lekin agar "
                "authorities evacuation bolein toh turant follow karein. Bijli/gas off kar dein.")

    return "Updates pe nazar rakhein."


def get_top_factors(input_dict: dict, n: int = 3) -> List[dict]:
    """
    Explainable AI feature: model ke overall feature_importance ko
    is specific prediction ke actual values ke saath combine karta hai,
    taaki bata sake 'is baar risk high/low kyun hai'.
    """
    importances = dict(zip(FEATURES, MODEL.feature_importances_))
    sorted_feats = sorted(importances.items(), key=lambda x: -x[1])[:n]
    result = []
    for feat, importance in sorted_feats:
        result.append({
            "factor": feat,
            "value": input_dict[feat],
            "importance_pct": round(importance * 100, 1)
        })
    return result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    return {"status": "Flash Flood Warning API is running", "model": saved.get("model_name")}


@app.post("/predict", response_model=FloodPredictionResponse)
def predict_flood(req: FloodPredictionRequest):
    # Request ko model ke expected format (DataFrame) mein convert karo
    input_dict = req.dict()
    X = pd.DataFrame([[input_dict[f] for f in FEATURES]], columns=FEATURES)

    # Model se probability nikalo
    probability = float(MODEL.predict_proba(X)[0][1])
    risk_level = get_risk_level(probability)
    warning = get_warning_message(risk_level)
    top_factors = get_top_factors(input_dict)

    return FloodPredictionResponse(
        location_name=req.location_name,
        flood_probability=round(probability, 3),
        risk_level=risk_level,
        warning_message=warning,
        top_contributing_factors=top_factors
    )


@app.post("/report")
def submit_community_report(report: CommunityReport):
    """Community verification feature — log apna ground-level report bhej sakte hain"""
    entry = report.dict()
    entry["timestamp"] = datetime.utcnow().isoformat()
    COMMUNITY_REPORTS.append(entry)
    return {"status": "success", "message": "Report darj ho gayi, dhanyawad!", "total_reports": len(COMMUNITY_REPORTS)}


@app.get("/reports")
def get_community_reports():
    """Saare community reports wapas bhejta hai — map pe pin dikhane ke liye"""
    return {"reports": COMMUNITY_REPORTS}


@app.get("/model-info")
def model_info():
    """Debug/demo ke liye — batata hai model ke baare mein"""
    importances = dict(zip(FEATURES, [round(x, 3) for x in MODEL.feature_importances_]))
    return {
        "model_name": saved.get("model_name"),
        "threshold": THRESHOLD,
        "features_used": FEATURES,
        "feature_importance": importances
    }


@app.post("/register")
def register_profile(profile: UserProfile):
    """
    Unique feature: one-time profile registration for personalized
    vulnerability-based alerts (not asked repeatedly — only once at signup).
    """
    entry = profile.dict()
    entry["registered_at"] = datetime.utcnow().isoformat()
    USER_PROFILES.append(entry)
    return {"status": "success", "message": f"Profile registered for {profile.name}", "total_profiles": len(USER_PROFILES)}


@app.get("/personalized-alerts")
def get_personalized_alerts(risk_level: str):
    """
    Har registered user ke liye unke profile ke hisaab se personalized
    action-advice generate karta hai, given a risk_level (e.g. from a /predict call).
    """
    if risk_level not in ("LOW", "MODERATE", "HIGH", "CRITICAL"):
        raise HTTPException(status_code=400, detail="risk_level must be LOW/MODERATE/HIGH/CRITICAL")

    alerts = []
    for profile in USER_PROFILES:
        action = get_personalized_action(risk_level, profile)
        alerts.append({
            "name": profile["name"],
            "location_name": profile["location_name"],
            "house_type": profile["house_type"],
            "floor": profile["floor"],
            "personalized_action": action
        })
    return {"risk_level": risk_level, "alerts": alerts}


@app.post("/analyze-image")
async def analyze_image(file: UploadFile = File(...)):
    """
    Unique feature: Visual water-level detection.
    User ek photo upload karta hai (river/road ki) — hum usme water-coverage
    estimate karte hain aur ML risk-score ke saath combine karne layak
    ek extra 'visual confidence' signal dete hain.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Sirf image files accepted hain")

    temp_path = f"/tmp/{file.filename}"
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    try:
        result = analyze_water_level(temp_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image process nahi ho payi: {str(e)}")

    return result


@app.post("/predict-combined", response_model=FloodPredictionResponse)
def predict_combined(req: FloodPredictionRequest, visual_coverage_pct: Optional[float] = None):
    """
    ML model ka prediction + (agar diya gaya ho) visual water-coverage %
    ko combine karke ek FINAL adjusted risk deta hai.
    Ye dikhata hai ki system do independent signals use karta hai —
    sirf sensor data pe depend nahi karta.
    """
    input_dict = req.dict()
    X = pd.DataFrame([[input_dict[f] for f in FEATURES]], columns=FEATURES)
    ml_probability = float(MODEL.predict_proba(X)[0][1])

    final_probability = ml_probability
    if visual_coverage_pct is not None:
        # Visual signal ko 25% weight dete hain, ML ko 75%
        # (ML zyada reliable hai kyunki structured historical data pe trained hai,
        # visual sirf ek supporting/sanity-check signal hai)
        visual_score = min(visual_coverage_pct / 100, 1.0)
        final_probability = (0.75 * ml_probability) + (0.25 * visual_score)

    risk_level = get_risk_level(final_probability)
    warning = get_warning_message(risk_level)
    top_factors = get_top_factors(input_dict)

    return FloodPredictionResponse(
        location_name=req.location_name,
        flood_probability=round(final_probability, 3),
        risk_level=risk_level,
        warning_message=warning,
        top_contributing_factors=top_factors
    )
