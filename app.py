from flask import Flask, render_template, Response, jsonify, request
from flask_cors import CORS
import cv2
import numpy as np
import base64
import time
from utils.drowsiness_detector import DrowsinessDetector

app = Flask(__name__)
CORS(app)

detector = DrowsinessDetector()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/analyze', methods=['POST'])
def analyze_frame():
    """Analyze a single frame sent from the browser."""
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'error': 'No image data'}), 400

        # Decode base64 image
        image_data = data['image'].split(',')[1] if ',' in data['image'] else data['image']
        image_bytes = base64.b64decode(image_data)
        nparr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({'error': 'Invalid image'}), 400

        # Run drowsiness detection
        result = detector.analyze(frame)
        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/reset', methods=['POST'])
def reset_detector():
    """Reset detector state."""
    detector.reset()
    return jsonify({'status': 'reset'})

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'model': detector.model_loaded})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
