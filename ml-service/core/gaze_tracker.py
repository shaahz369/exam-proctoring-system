import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import urllib.request
import os

class GazeTracker:
    def __init__(self):
        print("Initializing Head Pose Gaze Tracker (MediaPipe 0.10+)...")

        # Download the face landmarker model if not present
        model_path = "models/face_landmarker.task"
        if not os.path.exists(model_path):
            print("📥 Downloading face_landmarker.task model...")
            os.makedirs("models", exist_ok=True)
            urllib.request.urlretrieve(
                "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                model_path
            )
            print("✅ face_landmarker.task downloaded.")

        # Initialize FaceLandmarker with new 0.10+ API
        base_options = mp_python.BaseOptions(model_asset_path=model_path)
        options = mp_vision.FaceLandmarkerOptions(
            base_options=base_options,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.detector = mp_vision.FaceLandmarker.create_from_options(options)

        # Same landmark IDs as before
        # Nose tip, chin, left eye corner, right eye corner, left mouth, right mouth
        self.landmark_ids = [1, 199, 33, 263, 61, 291]

        print("✅ GazeTracker initialized successfully.")

    def predict(self, frame):
        """
        Takes a BGR numpy frame and returns (direction, pitch, yaw).
        Same return signature as before — no changes needed in ml_server.py.
        """
        if frame is None:
            return "ERROR", 0.0, 0.0

        h, w, _ = frame.shape

        # Convert BGR → RGB for mediapipe
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Wrap in mediapipe Image object (new 0.10+ requirement)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # Run detection
        result = self.detector.detect(mp_image)

        if not result.face_landmarks:
            return "NO_FACE", 0.0, 0.0

        face_landmarks = result.face_landmarks[0]

        face_2d = []
        face_3d = []

        for idx in self.landmark_ids:
            lm = face_landmarks[idx]
            x, y = int(lm.x * w), int(lm.y * h)
            face_2d.append([x, y])
            face_3d.append([x, y, lm.z])

        face_2d = np.array(face_2d, dtype=np.float64)
        face_3d = np.array(face_3d, dtype=np.float64)

        # Camera matrix (same as before)
        focal_length = 1 * w
        cam_matrix = np.array([
            [focal_length, 0, w / 2],
            [0, focal_length, h / 2],
            [0, 0, 1]
        ])
        dist_matrix = np.zeros((4, 1), dtype=np.float64)

        # Solve PnP (same as before)
        success, rot_vec, trans_vec = cv2.solvePnP(
            face_3d, face_2d, cam_matrix, dist_matrix
        )

        rmat, _ = cv2.Rodrigues(rot_vec)
        angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)

        pitch = angles[0] * 360
        yaw = angles[1] * 360

        # Direction logic (same thresholds as before)
        if yaw < -20:
            direction = "LOOKING_LEFT"
        elif yaw > 20:
            direction = "LOOKING_RIGHT"
        elif pitch < -20:
            direction = "LOOKING_DOWN"
        elif pitch > 20:
            direction = "LOOKING_UP"
        else:
            direction = "FOCUSED"

        return direction, pitch, yaw