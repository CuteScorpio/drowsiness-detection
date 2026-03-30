# 🚗 DrowseGuard — Driver Drowsiness Detection System

Real-time driver drowsiness detection using **MediaPipe Face Mesh** + **Eye Aspect Ratio (EAR)** deep learning pipeline. Works on desktop and mobile browsers.

## Features
- 👁️ Real-time eye closure detection (EAR algorithm)
- 🥱 Yawn detection (MAR algorithm)
- 📊 Drowsiness score (0–100)
- 🔊 Audio siren alert (Web Audio API — no external files)
- 📱 Mobile camera support (front & rear)
- 🔒 HTTPS-ready (required for mobile camera access)

## Local Development

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/drowsiness-detection.git
cd drowsiness-detection

# Create virtual environment
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run
python app.py
# Open http://localhost:5000
```

## Project Structure
```
drowsiness-detection/
├── app.py                    # Flask application
├── requirements.txt
├── gunicorn.conf.py          # Production server config
├── nginx.conf                # Nginx reverse proxy config
├── drowseguard.service       # Systemd service
├── utils/
│   └── drowsiness_detector.py  # Core detection logic (EAR + MAR)
├── templates/
│   └── index.html            # Main UI
└── static/
    ├── css/style.css
    └── js/app.js             # Camera handling + API calls
```

## How It Works

1. Browser captures video frames via `getUserMedia` API
2. Each frame is sent to Flask backend as base64 JPEG
3. MediaPipe Face Mesh extracts 468 facial landmarks
4. **EAR** (Eye Aspect Ratio) detects eye closure
5. **MAR** (Mouth Aspect Ratio) detects yawning
6. Drowsiness score computed; alert triggered if score ≥ 60
