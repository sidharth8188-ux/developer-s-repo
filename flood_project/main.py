from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import joblib
import numpy as np
import requests # We added this to make API calls!

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = joblib.load("model/flood_model.pkl")

# We changed this to expect coordinates from the map
class LocationData(BaseModel):
    latitude: float
    longitude: float

@app.post("/api/assess-risk")
def assess_risk(data: LocationData):
    # 1. Fetch live data from Open-Meteo API
    url = f"https://api.open-meteo.com/v1/forecast?latitude={data.latitude}&longitude={data.longitude}&current=precipitation,soil_moisture_0_to_1cm"
    
    try:
        response = requests.get(url).json()
        current_rain = response["current"]["precipitation"]
        soil_moisture = response["current"]["soil_moisture_0_to_1cm"]
    except:
        # Fallback in case the API fails
        current_rain = 0.0
        soil_moisture = 0.5
        
    # 2. We will estimate a 3-hour rainfall based on current rain
    rain_3h = current_rain * 3 
    
    # 3. For now, we will keep terrain data constant for the demo
    elevation = 1450
    slope = 32
    river_distance = 400

    # 4. Feed the LIVE data to the model
    features = np.array([[
        current_rain, 
        rain_3h, 
        elevation, 
        slope, 
        soil_moisture, 
        river_distance
    ]])
    
    prob = float(model.predict_proba(features)[0][1])
    
    if prob > 0.80:
        risk = "CRITICAL"
    elif prob > 0.60:
        risk = "HIGH"
    elif prob > 0.30:
        risk = "MODERATE"
    else:
        risk = "LOW"
        
   # Calculate a simulated "Safe Zone" (moving them slightly North-East to higher ground)
    safe_lat = data.latitude + 0.015
    safe_lon = data.longitude + 0.015
        
    return {
        "probability": round(prob * 100, 2),
        "risk_level": risk,
        "safe_zone": {
            "lat": safe_lat,
            "lon": safe_lon
        }
    }

app.mount("/", StaticFiles(directory="static", html=True), name="static")