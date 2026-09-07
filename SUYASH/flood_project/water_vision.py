"""
water_vision.py
------------------
Kya kaam karta hai:
Ek uploaded photo (river/road/nala ki) analyze karta hai aur estimate karta hai
ki kitna hissa "water" jaisa dikh raha hai — is percentage ko ek visual
confidence signal ki tarah ML prediction ke saath combine karte hain.

IMPORTANT — honest approach:
Real production system mein hum ek trained deep-learning segmentation model
(jaise YOLO ya U-Net) use karte, jo hazaaron labeled flood-images pe train
hota. Hackathon ke time-frame mein wo train karna practical nahi hai.

Isliye hum ek CLASSICAL COMPUTER VISION approach use kar rahe hain:
- Water ka ek characteristic color-range hota hai HSV (Hue-Saturation-Value)
  color space mein — muddy/flood water aam taur par grayish-brown ya
  murky-blue tone ka hota hai, aur usme low color-saturation hoti hai
  (saaf paani ke mukable)
- Hum image ko HSV mein convert karke us range ko "mask" karte hain
- Jo % pixels is range mein aate hain, wahi "water coverage estimate" hai

Ye 100% accurate nahi hai (ye tumhe demo mein bhi bologe judges ko — honest
rehna better hai), lekin ek REAL, WORKING signal hai jo tumhare ML risk-score
ke saath mil ke ek extra layer ki tarah kaam karta hai. Isko future mein
trained YOLO/segmentation model se replace kiya ja sakta hai — ye already
architecture mein bataya gaya hai (roadmap Phase 6+).
"""

import cv2
import numpy as np


def analyze_water_level(image_path: str) -> dict:
    """
    Image leke water-coverage % nikalta hai, aur ek severity label deta hai.
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Image read nahi ho payi — file corrupt ya unsupported format")

    # Resize karo taaki processing fast ho (bade images slow honge)
    img = cv2.resize(img, (640, 480))

    # ---- Step 1: HSV color space mein convert karo ----
    # RGB ke bajaye HSV isliye use kiya kyunki lighting-conditions
    # (dhoop/chaya) ke against zyada robust hota hai color-detection ke liye
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # ---- Step 2: Muddy/flood-water ka characteristic HSV range ----
    # Ye range murky brown-grey-blue water ko cover karta hai
    # (saturated colors jaise green trees, red rooftops isme nahi aayenge)
    lower_water = np.array([0, 0, 40])
    upper_water = np.array([180, 90, 180])
    water_mask = cv2.inRange(hsv, lower_water, upper_water)

    # ---- Step 3: Noise clean karo (chhote-chhote galat-detected pixels hatao) ----
    kernel = np.ones((5, 5), np.uint8)
    water_mask = cv2.morphologyEx(water_mask, cv2.MORPH_OPEN, kernel)
    water_mask = cv2.morphologyEx(water_mask, cv2.MORPH_CLOSE, kernel)

    # ---- Step 4: Coverage % calculate karo ----
    total_pixels = water_mask.shape[0] * water_mask.shape[1]
    water_pixels = int(np.sum(water_mask > 0))
    coverage_pct = round((water_pixels / total_pixels) * 100, 1)

    # ---- Step 5: Severity label ----
    if coverage_pct < 15:
        severity = "MINIMAL"
        note = "Bahut kam ya koi visible water logging nahi dikh raha."
    elif coverage_pct < 35:
        severity = "MODERATE"
        note = "Kuch water-logging dikh raha hai, monitor karte raho."
    elif coverage_pct < 55:
        severity = "SIGNIFICANT"
        note = "Kaafi water coverage dikh raha hai — caution rakho."
    else:
        severity = "SEVERE"
        note = "Frame ka bada hissa water se dhaka hai — high alert."

    return {
        "water_coverage_pct": coverage_pct,
        "severity": severity,
        "note": note,
        "method": "HSV color-range analysis (classical CV — see docstring for why)",
    }


if __name__ == "__main__":
    # Quick self-test: ek synthetic "flooded road" jaisi test image banao
    test_img = np.full((480, 640, 3), (60, 55, 50), dtype=np.uint8)  # muddy grey-brown
    cv2.imwrite("/tmp/test_water.jpg", test_img)
    result = analyze_water_level("/tmp/test_water.jpg")
    print("Test result on a fully 'muddy-colored' synthetic image:")
    print(result)
