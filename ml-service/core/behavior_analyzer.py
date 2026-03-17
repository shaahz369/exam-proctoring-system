# ml-service/core/behavior_analyzer.py
import os
import numpy as np
import torch
import torch.nn as nn


# ── Constants ──────────────────────────────────────────────────────────────────
SEQUENCE_LENGTH = 60        # 60 timesteps = 60 seconds at 1 FPS
NUM_FEATURES = 10           # Features per timestep
HIDDEN_SIZE = 64
NUM_LAYERS = 2
DROPOUT = 0.3

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "behavior_lstm.pth")


# ── LSTM Model Definition ─────────────────────────────────────────────────────
class BehaviorLSTM(nn.Module):
    """
    LSTM-based model for classifying candidate behavior as
    suspicious (cheating) or normal during an exam session.

    Input:  (batch, seq_len=60, features=10)
    Output: (batch, 1)  — sigmoid probability
    """

    def __init__(self, input_size=NUM_FEATURES, hidden_size=HIDDEN_SIZE,
                 num_layers=NUM_LAYERS, dropout=DROPOUT):
        super().__init__()

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )

        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        # x: (batch, seq_len, features)
        lstm_out, _ = self.lstm(x)
        # Take the last timestep's output
        last_hidden = lstm_out[:, -1, :]    # (batch, hidden_size)
        return self.classifier(last_hidden)  # (batch, 1)


# ── Feature Encoding Helper ───────────────────────────────────────────────────
def encode_frame_features(analysis: dict) -> list:
    """
    Takes the per-frame analysis dict from ObjectDetector + GazeTracker
    and returns a flat list of 10 numeric features.

    Expected keys in `analysis`:
        person_count   (int)
        phone_detected (bool)
        gaze_direction (str)   — FOCUSED / LOOKING_LEFT / LOOKING_RIGHT / etc.
        pitch          (float)
        yaw            (float)
    """
    person_count = analysis.get("person_count", 1)
    phone = 1 if analysis.get("phone_detected", False) else 0

    direction = analysis.get("gaze_direction", "FOCUSED")

    gaze_focused = 1 if direction == "FOCUSED" else 0
    gaze_left    = 1 if direction == "LOOKING_LEFT" else 0
    gaze_right   = 1 if direction == "LOOKING_RIGHT" else 0
    gaze_up      = 1 if direction == "LOOKING_UP" else 0
    gaze_down    = 1 if direction == "LOOKING_DOWN" else 0
    no_face      = 1 if direction in ("NO_FACE", "NO_FACE_DETECTED") else 0

    pitch = float(analysis.get("pitch", 0.0))
    yaw   = float(analysis.get("yaw", 0.0))

    # Cap person count to 3, then normalize to [0, 1] range
    person_count_norm = min(person_count, 3) / 3.0

    # Normalize pitch/yaw to roughly [-1.0, 1.0]. Avoid huge outliers > 90.
    pitch_norm = max(-1.0, min(1.0, pitch / 45.0))
    yaw_norm   = max(-1.0, min(1.0, yaw / 45.0))

    return [
        person_count_norm, phone,
        gaze_focused, gaze_left, gaze_right, gaze_up, gaze_down, no_face,
        pitch_norm, yaw_norm,
    ]


# ── Behavior Analyzer (Inference Wrapper) ──────────────────────────────────────
class BehaviorAnalyzer:
    """
    Loads a trained BehaviorLSTM and provides a predict() method
    that takes a list of per-frame feature vectors and returns
    a cheating prediction.
    """

    def __init__(self, model_path=MODEL_PATH):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = BehaviorLSTM().to(self.device)

        if os.path.exists(model_path):
            state = torch.load(model_path, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state)
            print(f"✅ Behavior LSTM loaded from {model_path}")
        else:
            print(f"⚠️  Behavior LSTM weights not found at {model_path} — using random weights!")

        self.model.eval()

    def _prepare_sequence(self, feature_buffer: list) -> torch.Tensor:
        """
        Pad or truncate the raw feature buffer to SEQUENCE_LENGTH
        and return a (1, SEQUENCE_LENGTH, NUM_FEATURES) tensor.
        """
        arr = np.array(feature_buffer, dtype=np.float32)

        if len(arr) == 0:
            arr = np.zeros((SEQUENCE_LENGTH, NUM_FEATURES), dtype=np.float32)
            arr[:, 0] = 1.0 / 3.0  # person_count defaults to 1 (normalized)
            arr[:, 2] = 1.0        # gaze_focused defaults to 1
        elif len(arr) < SEQUENCE_LENGTH:
            # Pad with "normal" baseline (person=1, focused=1) instead of zeros
            pad = np.zeros((SEQUENCE_LENGTH - len(arr), NUM_FEATURES), dtype=np.float32)
            pad[:, 0] = 1.0 / 3.0
            pad[:, 2] = 1.0
            arr = np.concatenate([pad, arr], axis=0)
        else:
            # Take the last SEQUENCE_LENGTH frames (most recent behavior)
            arr = arr[-SEQUENCE_LENGTH:]

        tensor = torch.tensor(arr, dtype=torch.float32).unsqueeze(0)  # (1, seq, feat)
        return tensor.to(self.device)

    def predict(self, feature_buffer: list) -> dict:
        """
        Run LSTM inference on accumulated feature vectors.

        Args:
            feature_buffer: list of lists, each inner list has 10 floats

        Returns:
            {
                "is_suspicious": bool,
                "confidence": float,     # 0.0 - 1.0
                "risk_level": str,       # "low" | "medium" | "high"
                "summary": str           # human-readable summary
            }
        """
        if not feature_buffer:
            return {
                "is_suspicious": False,
                "confidence": 0.0,
                "risk_level": "low",
                "summary": "No behavioral data collected during the session.",
            }

        seq = self._prepare_sequence(feature_buffer)

        with torch.no_grad():
            prob = self.model(seq).item()

        is_suspicious = prob > 0.5
        confidence = round(prob, 4)

        if prob < 0.4:
            risk_level = "low"
        elif prob < 0.7:
            risk_level = "medium"
        else:
            risk_level = "high"

        # Build a human-readable summary
        total_frames = len(feature_buffer)
        arr = np.array(feature_buffer)
        phone_frames = int(arr[:, 1].sum()) if total_frames > 0 else 0
        multi_person_frames = int((arr[:, 0] > 1).sum()) if total_frames > 0 else 0
        gaze_away_frames = int((arr[:, 2] == 0).sum()) if total_frames > 0 else 0  # not focused

        parts = []
        if phone_frames > 0:
            parts.append(f"phone detected in {phone_frames}/{total_frames} frames")
        if multi_person_frames > 0:
            parts.append(f"multiple persons in {multi_person_frames}/{total_frames} frames")
        if total_frames > 0:
            gaze_pct = round(gaze_away_frames / total_frames * 100, 1)
            if gaze_pct > 20:
                parts.append(f"gaze away {gaze_pct}% of session")

        if parts:
            summary = f"AI analysis ({confidence*100:.1f}% confidence): " + "; ".join(parts) + "."
        else:
            summary = f"AI analysis ({confidence*100:.1f}% confidence): No significant anomalies detected."

        return {
            "is_suspicious": is_suspicious,
            "confidence": confidence,
            "risk_level": risk_level,
            "summary": summary,
        }
