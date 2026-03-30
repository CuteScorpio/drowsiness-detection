from flask import Flask, render_template, request, jsonify
import cv2
import mediapipe as mp
import numpy as np

app = Flask(__name__)

mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(refine_landmarks=True)

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

def eye_aspect_ratio(eye):
    A = np.linalg.norm(np.array(eye[1]) - np.array(eye[5]))
    B = np.linalg.norm(np.array(eye[2]) - np.array(eye[4]))
    C = np.linalg.norm(np.array(eye[0]) - np.array(eye[3]))
    return (A + B) / (2.0 * C)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/detect", methods=["POST"])
def detect():
    file = request.files['frame']
    npimg = np.frombuffer(file.read(), np.uint8)
    frame = cv2.imdecode(npimg, cv2.IMREAD_COLOR)

    h, w, _ = frame.shape
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)

    drowsy = False

    if results.multi_face_landmarks:
        for face_landmarks in results.multi_face_landmarks:
            mesh_points = [(int(p.x * w), int(p.y * h)) for p in face_landmarks.landmark]

            left_eye = [mesh_points[i] for i in LEFT_EYE]
            right_eye = [mesh_points[i] for i in RIGHT_EYE]

            left_EAR = eye_aspect_ratio(left_eye)
            right_EAR = eye_aspect_ratio(right_eye)

            ear = (left_EAR + right_EAR) / 2.0

            if ear < 0.25:
                drowsy = True

    return jsonify({"drowsy": drowsy})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)