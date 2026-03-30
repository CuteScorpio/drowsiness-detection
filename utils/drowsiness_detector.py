import cv2
import numpy as np
import time
from collections import deque

try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False

# Eye landmark indices for MediaPipe Face Mesh
LEFT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]

LEFT_EYE_EAR = [362, 385, 387, 263, 373, 380]
RIGHT_EYE_EAR = [33, 160, 158, 133, 153, 144]

MOUTH_EAR = [61, 291, 0, 17, 269, 405, 314, 82]

EAR_THRESHOLD = 0.25          # Eye aspect ratio below this = closed
MAR_THRESHOLD = 0.65          # Mouth aspect ratio above this = yawning
EAR_CONSEC_FRAMES = 15        # Frames eye must be closed to trigger alert
YAWN_CONSEC_FRAMES = 20       # Frames mouth must be open to count as yawn
DROWSY_SCORE_THRESHOLD = 60   # Score to trigger drowsiness alert
ALERT_COOLDOWN = 3.0          # Seconds between alerts


def eye_aspect_ratio(landmarks, eye_indices, w, h):
    """Compute Eye Aspect Ratio (EAR)."""
    pts = [(int(landmarks[i].x * w), int(landmarks[i].y * h)) for i in eye_indices]
    # Vertical distances
    v1 = np.linalg.norm(np.array(pts[1]) - np.array(pts[5]))
    v2 = np.linalg.norm(np.array(pts[2]) - np.array(pts[4]))
    # Horizontal distance
    h1 = np.linalg.norm(np.array(pts[0]) - np.array(pts[3]))
    if h1 == 0:
        return 0.0
    return (v1 + v2) / (2.0 * h1)


def mouth_aspect_ratio(landmarks, w, h):
    """Compute Mouth Aspect Ratio (MAR) for yawn detection."""
    pts = [(int(landmarks[i].x * w), int(landmarks[i].y * h)) for i in MOUTH_EAR]
    v1 = np.linalg.norm(np.array(pts[2]) - np.array(pts[6]))
    v2 = np.linalg.norm(np.array(pts[3]) - np.array(pts[7]))
    v3 = np.linalg.norm(np.array(pts[4]) - np.array(pts[5]))
    h1 = np.linalg.norm(np.array(pts[0]) - np.array(pts[1]))
    if h1 == 0:
        return 0.0
    return (v1 + v2 + v3) / (3.0 * h1)


class DrowsinessDetector:
    def __init__(self):
        self.model_loaded = False
        self.ear_history = deque(maxlen=30)
        self.mar_history = deque(maxlen=30)

        # Counters
        self.eye_closed_frames = 0
        self.yawn_frames = 0
        self.total_yawns = 0
        self.drowsy_score = 0
        self.alert_active = False
        self.last_alert_time = 0
        self.session_start = time.time()
        self.no_face_frames = 0

        # Status tracking
        self.status = "ACTIVE"
        self.eye_status = "OPEN"
        self.yawn_status = "NO YAWN"

        if MEDIAPIPE_AVAILABLE:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
            self.model_loaded = True

    def reset(self):
        """Reset all counters."""
        self.eye_closed_frames = 0
        self.yawn_frames = 0
        self.total_yawns = 0
        self.drowsy_score = 0
        self.alert_active = False
        self.last_alert_time = 0
        self.status = "ACTIVE"
        self.eye_status = "OPEN"
        self.yawn_status = "NO YAWN"
        self.ear_history.clear()
        self.mar_history.clear()
        self.session_start = time.time()
        self.no_face_frames = 0

    def analyze(self, frame):
        """Main analysis method. Returns detection results as dict."""
        if not self.model_loaded:
            return self._fallback_analysis(frame)

        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb)

        if not results.multi_face_landmarks:
            self.no_face_frames += 1
            return {
                'face_detected': False,
                'status': 'NO_FACE',
                'ear': 0,
                'mar': 0,
                'drowsy_score': self.drowsy_score,
                'eye_status': self.eye_status,
                'yawn_status': self.yawn_status,
                'alert': False,
                'yawn_count': self.total_yawns,
                'session_time': int(time.time() - self.session_start),
                'landmarks': []
            }

        self.no_face_frames = 0
        face_landmarks = results.multi_face_landmarks[0].landmark

        # Compute EAR
        left_ear = eye_aspect_ratio(face_landmarks, LEFT_EYE_EAR, w, h)
        right_ear = eye_aspect_ratio(face_landmarks, RIGHT_EYE_EAR, w, h)
        ear = (left_ear + right_ear) / 2.0

        # Compute MAR
        mar = mouth_aspect_ratio(face_landmarks, w, h)

        self.ear_history.append(ear)
        self.mar_history.append(mar)

        avg_ear = np.mean(self.ear_history) if self.ear_history else ear
        avg_mar = np.mean(self.mar_history) if self.mar_history else mar

        # Eye state
        if avg_ear < EAR_THRESHOLD:
            self.eye_closed_frames += 1
            self.eye_status = "CLOSED"
        else:
            self.eye_closed_frames = 0
            self.eye_status = "OPEN"

        # Yawn state
        if avg_mar > MAR_THRESHOLD:
            self.yawn_frames += 1
            self.yawn_status = "YAWNING"
        else:
            if self.yawn_frames >= YAWN_CONSEC_FRAMES:
                self.total_yawns += 1
            self.yawn_frames = 0
            self.yawn_status = "NO YAWN"

        # Drowsiness score calculation
        eye_score = min(40, (self.eye_closed_frames / EAR_CONSEC_FRAMES) * 40)
        yawn_score = min(30, self.total_yawns * 10)
        yawn_frame_score = min(30, (self.yawn_frames / YAWN_CONSEC_FRAMES) * 30)
        self.drowsy_score = min(100, int(eye_score + yawn_score + yawn_frame_score))

        # Alert logic
        now = time.time()
        should_alert = (
            self.drowsy_score >= DROWSY_SCORE_THRESHOLD or
            self.eye_closed_frames >= EAR_CONSEC_FRAMES
        ) and (now - self.last_alert_time > ALERT_COOLDOWN)

        if should_alert:
            self.alert_active = True
            self.last_alert_time = now
            self.status = "DROWSY"
        elif self.drowsy_score < 30:
            self.alert_active = False
            self.status = "ACTIVE"
        else:
            self.status = "WARNING"

        # Prepare landmark data for frontend overlay (key points only)
        key_indices = LEFT_EYE_EAR + RIGHT_EYE_EAR + [1, 33, 263, 61, 291]
        landmarks_out = []
        for i in key_indices:
            lm = face_landmarks[i]
            landmarks_out.append({'x': lm.x, 'y': lm.y, 'index': i})

        return {
            'face_detected': True,
            'status': self.status,
            'ear': round(float(ear), 3),
            'mar': round(float(mar), 3),
            'avg_ear': round(float(avg_ear), 3),
            'avg_mar': round(float(avg_mar), 3),
            'drowsy_score': self.drowsy_score,
            'eye_status': self.eye_status,
            'yawn_status': self.yawn_status,
            'alert': self.alert_active,
            'eye_closed_frames': self.eye_closed_frames,
            'yawn_count': self.total_yawns,
            'session_time': int(time.time() - self.session_start),
            'landmarks': landmarks_out
        }

    def _fallback_analysis(self, frame):
        """Fallback when mediapipe not available - returns placeholder."""
        return {
            'face_detected': False,
            'status': 'MODEL_NOT_LOADED',
            'ear': 0,
            'mar': 0,
            'drowsy_score': 0,
            'eye_status': 'UNKNOWN',
            'yawn_status': 'UNKNOWN',
            'alert': False,
            'yawn_count': 0,
            'session_time': 0,
            'landmarks': []
        }
