import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import joblib
import os

# 1. We create some sample historical data (like a mini-spreadsheet)
# This includes rainfall, elevation, slope, soil moisture, and whether it flooded (1) or not (0)
data = {
    "rainfall_1h": [12, 65, 8, 82, 10, 75, 90, 15],
    "rainfall_3h": [35, 142, 21, 190, 25, 160, 210, 40],
    "elevation": [1450, 1200, 1600, 1100, 1500, 1150, 1050, 1400],
    "slope": [28, 35, 20, 38, 22, 34, 40, 25],
    "soil_moisture": [0.62, 0.91, 0.40, 0.95, 0.50, 0.88, 0.98, 0.60],
    "river_distance": [500, 300, 900, 250, 800, 280, 180, 600],
    "flood": [0, 1, 0, 1, 0, 1, 1, 0]
}
df = pd.DataFrame(data)

# 2. Separate our features (the weather/terrain) from our target (the flood result)
X = df[["rainfall_1h", "rainfall_3h", "elevation", "slope", "soil_moisture", "river_distance"]]
y = df["flood"]

# 3. Train the Random Forest model
print("Training the model...")
model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X, y)

# 4. Save the trained model as a file so our app can use it later
# Ensure we are saving it inside the 'model' folder
file_path = os.path.join("model", "flood_model.pkl")
joblib.dump(model, file_path)

print(f"Success! Model trained and saved as {file_path}")