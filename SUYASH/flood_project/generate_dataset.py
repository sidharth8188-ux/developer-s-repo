"""
generate_dataset.py
--------------------
Kya kaam karta hai:
Ye script ek REALISTIC synthetic dataset banata hai flash-flood prediction ke liye.
Real duniya mein tumhe ye data alag-alag sources (weather API + DEM + flood records)
se milake banana padta, lekin hackathon ke shuruwati phase mein humein sirf ek
WORKING dataset chahiye taaki ML pipeline test kar sakein.

Logic (physics-based, random nahi):
- Zyada rainfall + high soil moisture + steep slope + river ke paas = zyada flood chance
- Kam rainfall + dry soil + flat land + river se door = kam flood chance
- Thoda randomness bhi daala hai taaki real duniya jaisa "noise" ho
"""

import numpy as np
import pandas as pd

np.random.seed(42)  # taaki result har baar same aaye (reproducibility)

N = 2000  # kitni rows banani hain

# ---- Step 1: Har feature ko realistic range mein randomly generate karo ----
rainfall_1h = np.random.gamma(shape=2.0, scale=15, size=N)          # 0-150 mm typical
rainfall_3h = rainfall_1h * np.random.uniform(1.8, 3.2, N)          # 3h hamesha 1h se zyada hoga
rainfall_24h = rainfall_3h * np.random.uniform(1.5, 4.0, N)         # 24h sabse zyada

elevation = np.random.uniform(300, 3000, N)                          # meters (hilly region)
slope = np.random.uniform(2, 45, N)                                  # degrees
soil_moisture = np.random.uniform(0.1, 1.0, N)                       # 0=dry, 1=saturated
river_distance = np.random.exponential(scale=600, size=N)            # meters, zyada log door hote hain
river_distance = np.clip(river_distance, 20, 5000)

humidity = np.random.uniform(40, 100, N)

# ---- Step 2: Flood probability ko PHYSICS-BASED logic se calculate karo ----
# Har factor ka ek "weight" hai based on real-world importance
# (Ye weights hackathon presentation mein bhi explain kar sakte ho)

risk_score = (
    0.35 * (rainfall_3h / rainfall_3h.max()) +          # sabse important factor
    0.20 * (soil_moisture) +                              # saturated soil = zyada runoff
    0.15 * (slope / slope.max()) +                        # steep slope = fast water flow
    0.15 * (1 - river_distance / river_distance.max()) +  # river ke paas = zyada risk
    0.10 * (rainfall_24h / rainfall_24h.max()) +
    0.05 * (humidity / 100)
)

# Thoda random noise add karo (real duniya perfect nahi hoti — lekin kam rakha hai
# taaki signal clear rahe aur model achhe se seekh sake)
risk_score += np.random.normal(0, 0.03, N)
risk_score = np.clip(risk_score, 0, 1)

# ---- Step 3: Flood label banao (0/1) — MOSTLY threshold-based ----
# Real-world mein bhi flood/no-flood ek THRESHOLD ke around decide hoti hai
# (jaise PDF mein tha: 60%+ = HIGH risk). Isliye threshold=0.5 rakha hai,
# aur sirf THODA sa randomness mila hai taaki data 100% perfect na ho
# (warna model 'too easy' seekh lega, jo real duniya jaisa nahi hoga)
threshold_flood = (risk_score > 0.5).astype(int)
random_flip = np.random.rand(N) < 0.08  # 8% cases mein label thoda uncertain/noisy rakha
flood = np.where(random_flip, 1 - threshold_flood, threshold_flood)

# ---- Step 4: Sab kuch ek DataFrame mein daalo ----
df = pd.DataFrame({
    "rainfall_1h": rainfall_1h.round(1),
    "rainfall_3h": rainfall_3h.round(1),
    "rainfall_24h": rainfall_24h.round(1),
    "humidity": humidity.round(1),
    "elevation": elevation.round(0),
    "slope": slope.round(1),
    "soil_moisture": soil_moisture.round(2),
    "river_distance": river_distance.round(0),
    "flood": flood
})

df.to_csv("flood_training.csv", index=False)

print("✅ Dataset ban gaya: flood_training.csv")
print(f"Total rows: {len(df)}")
print(f"Flood cases (1): {df['flood'].sum()} ({df['flood'].mean()*100:.1f}%)")
print(f"No-flood cases (0): {(df['flood']==0).sum()} ({(1-df['flood'].mean())*100:.1f}%)")
print("\nPehli 5 rows:")
print(df.head())
