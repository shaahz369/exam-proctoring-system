import cv2
import numpy as np
import onnxruntime as ort
import time
import csv
from datetime import datetime
import os

# --- CONFIGURATION ---
# Use absolute path resolving so it works no matter where main.py is run from
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(CURRENT_DIR, "..", "models", "resnet18_gaze.onnx")
INPUT_SIZE = (448, 448)

# ⚠️ ULTRA-STRICT MODE: Negative padding shrinks the safe zone inside the monitor
LENIENCY_FACTOR = -0.05 

class GazeTracker:
    def __init__(self, model_path=MODEL_PATH):
        print(f"Loading Gaze Model from: {model_path}")
        try:
            self.session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
            self.input_name = self.session.get_inputs()[0].name
        except Exception as e:
            print(f"❌ Error loading Gaze model: {e}")
            raise e

        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        
        # --- DYNAMIC CALIBRATION STATE ---
        self.is_calibrated = False
        self.calib_states = ["PROMPT_LEFT", "PROMPT_RIGHT", "PROMPT_UP", "PROMPT_DOWN", "PROCTORING"]
        self.current_state_idx = 0
        
        self.calibration_data = {'LEFT': [], 'RIGHT': [], 'UP': [], 'DOWN': []}
        self.safe_zone = {
            'yaw_min': 0.0, 'yaw_max': 0.0, 
            'pitch_min': 0.0, 'pitch_max': 0.0,
            'yaw_pad': 0.0, 'pitch_pad': 0.0
        }
        
        self.frames_to_capture = 10
        self.capture_counter = 0
        self.is_capturing = False

    def _preprocess(self, face_crop):
        img = cv2.resize(face_crop, INPUT_SIZE)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img = img.astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406])
        std = np.array([0.229, 0.224, 0.225])
        img = (img - mean) / std
        img = img.transpose(2, 0, 1)
        return np.expand_dims(img, axis=0).astype(np.float32)

    def _softmax(self, x):
        e_x = np.exp(x - np.max(x, axis=1, keepdims=True))
        return e_x / e_x.sum(axis=1, keepdims=True)

    def _decode_gaze(self, yaw_logits, pitch_logits):
        _bins = 90
        _binwidth = 4
        _angle_offset = 180
        idx_tensor = np.arange(_bins, dtype=np.float32)
        yaw_probs = self._softmax(yaw_logits)
        pitch_probs = self._softmax(pitch_logits)
        yaw = np.sum(yaw_probs * idx_tensor, axis=1) * _binwidth - _angle_offset
        pitch = np.sum(pitch_probs * idx_tensor, axis=1) * _binwidth - _angle_offset
        return np.radians(pitch[0]), np.radians(yaw[0])

    def predict(self, frame):
        """
        Processes a single frame and returns the gaze status, pitch, and yaw.
        Since this is running in a server environment, we bypass the manual Spacebar 
        calibration and use a fast-tracked auto-calibration for the first few frames, 
        or you can initialize it with default strict boundaries.
        """
        # Flip frame horizontally for natural mirroring
        frame = cv2.flip(frame, 1)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Optimize face detection for speed
        faces = self.face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(100, 100))
        
        if len(faces) == 0:
            return "NO_FACE", 0.0, 0.0

        # Get largest face
        x, y, w, h = max(faces, key=lambda rect: rect[2] * rect[3])
        pad = 40
        x1, y1 = max(0, x - pad), max(0, y - pad)
        x2, y2 = min(frame.shape[1], x + w + pad), min(frame.shape[0], y + h + pad)
        face_crop = frame[y1:y2, x1:x2]

        if face_crop.shape[0] <= 0 or face_crop.shape[1] <= 0:
            return "NO_FACE", 0.0, 0.0

        # Inference
        input_tensor = self._preprocess(face_crop)
        output_names = [out.name for out in self.session.get_outputs()]
        outputs = self.session.run(output_names, {self.input_name: input_tensor})
        pitch, yaw = self._decode_gaze(outputs[0], outputs[1])

        # ---------------------------------------------------------
        # SERVER-SIDE FAST CALIBRATION (Auto-centers on first frames)
        # Because we can't press 'Spacebar' on the FastAPI server, 
        # we assume the first 20 frames the user is looking at the screen.
        # ---------------------------------------------------------
        if not self.is_calibrated:
            self.calibration_data['UP'].append(pitch)
            self.calibration_data['RIGHT'].append(yaw)
            
            if len(self.calibration_data['UP']) >= 20:
                # Build a strict simulated bounding box based on their natural center
                center_pitch = np.mean(self.calibration_data['UP'])
                center_yaw = np.mean(self.calibration_data['RIGHT'])
                
                # Assuming typical screen width/height pupil movement ratios
                self.safe_zone['yaw_min'] = center_yaw - 0.25
                self.safe_zone['yaw_max'] = center_yaw + 0.25
                self.safe_zone['pitch_min'] = center_pitch - 0.15
                self.safe_zone['pitch_max'] = center_pitch + 0.20
                
                self.safe_zone['yaw_pad'] = (self.safe_zone['yaw_max'] - self.safe_zone['yaw_min']) * LENIENCY_FACTOR
                self.safe_zone['pitch_pad'] = (self.safe_zone['pitch_max'] - self.safe_zone['pitch_min']) * LENIENCY_FACTOR
                
                self.is_calibrated = True
                print("✅ Gaze Auto-Calibration Complete.")
            
            return "CALIBRATING", float(pitch), float(yaw)

        # ---------------------------------------------------------
        # STRICT PROCTORING PHASE
        # ---------------------------------------------------------
        status = "FOCUSED"
        
        # Apply Boundaries with NEGATIVE padding (shrinks the box inward)
        y_min = self.safe_zone['yaw_min'] - self.safe_zone['yaw_pad']
        y_max = self.safe_zone['yaw_max'] + self.safe_zone['yaw_pad']
        
        # Shrink pitch even more to catch downward keyboard glances instantly
        p_min = self.safe_zone['pitch_min'] - (self.safe_zone['pitch_pad'] * 1.5) 
        p_max = self.safe_zone['pitch_max'] + self.safe_zone['pitch_pad']
        
        if yaw < y_min:
            status = "LOOKING_LEFT"
        elif yaw > y_max:
            status = "LOOKING_RIGHT"
        elif pitch < p_min:
            status = "LOOKING_DOWN"
        elif pitch > p_max:
            status = "LOOKING_UP"

        return status, float(pitch), float(yaw)

# If you want to test it locally from the terminal without the FastAPI server:
if __name__ == "__main__":
    tracker = GazeTracker()
    cap = cv2.VideoCapture(0)
    
    print("Testing strict gaze tracking. Look straight ahead for 2 seconds to calibrate...")
    
    while True:
        ret, frame = cap.read()
        if not ret: break
        
        status, pitch, yaw = tracker.predict(frame)
        
        color = (0, 255, 0) if status == "FOCUSED" else (0, 0, 255)
        if status == "CALIBRATING": color = (0, 255, 255)
            
        cv2.putText(frame, f"STATUS: {status}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 3)
        cv2.putText(frame, f"Pitch: {pitch:.2f} | Yaw: {yaw:.2f}", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        
        cv2.imshow("Strict Gaze Test", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
            
    cap.release()
    cv2.destroyAllWindows()