# core/gaze_tracker.py
import cv2
import numpy as np
import mediapipe as mp

# ── Safe-zone leniency ────────────────────────────────────────────────────────
# Multiplied against the calibrated span to expand boundaries outward.
# Increase for more tolerance, decrease for stricter detection.
YAW_LENIENCY   = 0.35
PITCH_LENIENCY = 0.25

# ── Minimum calibrated spans ──────────────────────────────────────────────────
# Prevents a too-narrow calibration (user barely moved eyes to corners)
# from triggering on micro head movements.
MIN_YAW_SPAN   = 0.18
MIN_PITCH_SPAN = 0.12

# ── EMA smoothing weight on NEW value ─────────────────────────────────────────
# Frames arrive at ~1 fps from the frontend, so each frame carries a lot of
# weight. Keep this low to avoid reacting to single noisy frames.
# Range: 0.10 (very smooth, some lag) → 0.40 (more reactive, more noise).
EMA_ALPHA = 0.20

# ── Majority-vote history window ──────────────────────────────────────────────
# At 1 fps, history_size=3 means a direction must dominate for ~3 seconds.
# Keeps the signal stable without introducing excessive lag.
HISTORY_SIZE = 3


class GazeTracker:
    def __init__(self):
        print("🚀 Initializing GazeTracker...")

        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh    = self.mp_face_mesh.FaceMesh(
            refine_landmarks=True,   # MUST be True — iris points 469-477 only exist here
            max_num_faces=1,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        self.prev_pitch = None
        self.prev_yaw   = None

        self.is_calibrated = False
        self.safe_zone     = {}
        self.calib_buffer  = {}
        self.gaze_history  = []

    # ── Landmark index constants ───────────────────────────────────────────────
    # Iris rings (478-point mesh only, requires refine_landmarks=True)
    LEFT_IRIS  = [474, 475, 476, 477]
    RIGHT_IRIS = [469, 470, 471, 472]

    # Horizontal eye corners (medial / lateral canthus)
    LEFT_EYE_INNER  = 133
    LEFT_EYE_OUTER  = 33
    RIGHT_EYE_INNER = 362
    RIGHT_EYE_OUTER = 263

    # Vertical eyelid landmarks (used for pitch normalisation)
    LEFT_EYE_TOP     = 159
    LEFT_EYE_BOTTOM  = 145
    RIGHT_EYE_TOP    = 386
    RIGHT_EYE_BOTTOM = 374

    # ── Private helpers ────────────────────────────────────────────────────────

    def _pt(self, lm, idx, w, h):
        """Single landmark → pixel coordinate numpy array."""
        p = lm.landmark[idx]
        return np.array([p.x * w, p.y * h])

    def _iris_center(self, lm, indices, w, h):
        """Mean pixel position of an iris landmark ring."""
        return np.mean([self._pt(lm, i, w, h) for i in indices], axis=0)

    def _get_landmarks(self, frame):
        """Run MediaPipe on a BGR frame; return first face or None."""
        rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self.face_mesh.process(rgb)
        if not result.multi_face_landmarks:
            return None
        return result.multi_face_landmarks[0]

    def _compute_gaze(self, frame):
        """
        Compute (pitch, yaw) from a BGR frame.

        ── Flip contract ─────────────────────────────────────────────────────
        This method receives the frame EXACTLY as given — it does NOT flip.
        Both add_calibration_frame() and predict() flip the frame themselves
        BEFORE calling here, ensuring calibration and monitoring always measure
        the same mirrored orientation. Keeping the flip outside this method
        makes the contract explicit and prevents double-flip bugs.

        ── Yaw ───────────────────────────────────────────────────────────────
        Iris x position relative to inner corner, normalised by eye width,
        then centred at 0. Negative = looking left, positive = looking right.

        ── Pitch ─────────────────────────────────────────────────────────────
        Iris y position relative to upper eyelid, normalised by eye HEIGHT
        (not width — that was the old bug that broke for different distances).
        Centred at 0. Negative = looking up, positive = looking down.
        Falls back to midline/width normalisation if eye is nearly closed.

        Returns (pitch, yaw) or (None, None) on failure.
        """
        h, w = frame.shape[:2]

        lm = self._get_landmarks(frame)
        if lm is None:
            return None, None

        # Guard: refine_landmarks=True produces exactly 478 points
        if len(lm.landmark) < 478:
            return None, None

        try:
            left_iris  = self._iris_center(lm, self.LEFT_IRIS,  w, h)
            right_iris = self._iris_center(lm, self.RIGHT_IRIS, w, h)

            # Horizontal eye corners
            l_inner = self._pt(lm, self.LEFT_EYE_INNER,  w, h)
            l_outer = self._pt(lm, self.LEFT_EYE_OUTER,  w, h)
            r_inner = self._pt(lm, self.RIGHT_EYE_INNER, w, h)
            r_outer = self._pt(lm, self.RIGHT_EYE_OUTER, w, h)

            # Vertical eyelid points
            l_top    = self._pt(lm, self.LEFT_EYE_TOP,     w, h)
            l_bottom = self._pt(lm, self.LEFT_EYE_BOTTOM,  w, h)
            r_top    = self._pt(lm, self.RIGHT_EYE_TOP,    w, h)
            r_bottom = self._pt(lm, self.RIGHT_EYE_BOTTOM, w, h)

            left_eye_w  = np.linalg.norm(l_outer - l_inner)
            right_eye_w = np.linalg.norm(r_outer - r_inner)
            left_eye_h  = np.linalg.norm(l_bottom - l_top)
            right_eye_h = np.linalg.norm(r_bottom - r_top)

            # Degenerate frame — face too turned or eye fully occluded
            if left_eye_w < 5.0 or right_eye_w < 5.0:
                return None, None

            # ── Yaw ───────────────────────────────────────────────────────
            # (iris_x - inner_corner_x) / eye_width  gives [0,1];
            # subtracting 0.5 centres it so 0 = straight ahead.
            left_yaw  = (left_iris[0]  - l_inner[0]) / left_eye_w  - 0.5
            right_yaw = (right_iris[0] - r_inner[0]) / right_eye_w - 0.5
            yaw = (left_yaw + right_yaw) / 2.0

            # ── Pitch ─────────────────────────────────────────────────────
            # Use eye HEIGHT for normalisation — scale-invariant across
            # different camera distances. Eye width was the old bug.
            if left_eye_h > 2.0 and right_eye_h > 2.0:
                left_pitch  = (left_iris[1]  - l_top[1]) / left_eye_h  - 0.5
                right_pitch = (right_iris[1] - r_top[1]) / right_eye_h - 0.5
            else:
                # Eye nearly closed — fall back to midline / width normalisation
                l_mid_y = (l_top[1] + l_bottom[1]) / 2.0
                r_mid_y = (r_top[1] + r_bottom[1]) / 2.0
                left_pitch  = (left_iris[1]  - l_mid_y) / max(left_eye_w,  1.0)
                right_pitch = (right_iris[1] - r_mid_y) / max(right_eye_w, 1.0)
            pitch = (left_pitch + right_pitch) / 2.0

            # ── EMA smoothing ──────────────────────────────────────────────
            if self.prev_pitch is None:
                self.prev_pitch = pitch
                self.prev_yaw   = yaw
            else:
                pitch = EMA_ALPHA * pitch + (1.0 - EMA_ALPHA) * self.prev_pitch
                yaw   = EMA_ALPHA * yaw   + (1.0 - EMA_ALPHA) * self.prev_yaw
                self.prev_pitch = pitch
                self.prev_yaw   = yaw

            return float(pitch), float(yaw)

        except Exception as e:
            print(f"Gaze calculation error: {e}")
            return None, None

    # ── Calibration API ────────────────────────────────────────────────────────

    def reset_calibration(self):
        """Call between exam sessions so each student gets a clean start."""
        self.is_calibrated = False
        self.safe_zone     = {}
        self.calib_buffer  = {}
        self.prev_pitch    = None
        self.prev_yaw      = None
        self.gaze_history  = []

    def add_calibration_frame(self, frame, point_id: str):
        """
        Accumulate pitch/yaw readings for one calibration point.
        Frame is flipped here (same as predict) — see _compute_gaze docstring.
        Returns (face_detected, pitch, yaw).
        """
        flipped       = cv2.flip(frame, 1)
        pitch, yaw    = self._compute_gaze(flipped)
        face_detected = pitch is not None

        if not face_detected:
            return False, 0.0, 0.0

        if point_id not in self.calib_buffer:
            self.calib_buffer[point_id] = {"pitches": [], "yaws": []}

        self.calib_buffer[point_id]["pitches"].append(pitch)
        self.calib_buffer[point_id]["yaws"].append(yaw)

        return True, float(pitch), float(yaw)

    def finalize_calibration(self) -> dict:
        """
        Compute personalised safe zone from the 5-point calibration buffer.

        Strategy
        ────────
        1. Median of LEFT points → yaw_min
           Median of RIGHT points → yaw_max
           Median of TOP points   → pitch_min
           Median of BOTTOM points → pitch_max
           (Median is used instead of mean — robust to outlier frames.)

        2. CENTER reading is used to re-anchor the zone so that the user's
           natural forward gaze always sits well inside the boundary, even
           when the corner spread was narrow (eyes barely moved to corners).

        3. Minimum span enforcement keeps the zone from collapsing to a
           sliver for users with very precise eye movements.

        4. LENIENCY expansion adds padding proportional to the span so the
           zone is generous enough to allow natural micro-movements.
        """
        buf = self.calib_buffer

        def med(ids, key):
            vals = []
            for pid in ids:
                if pid in buf:
                    vals.extend(buf[pid][key])
            return float(np.median(vals)) if vals else 0.0

        # Step 1 — corner medians
        y_min = med(["TOP_LEFT",  "BOTTOM_LEFT"],  "yaws")
        y_max = med(["TOP_RIGHT", "BOTTOM_RIGHT"], "yaws")
        p_min = med(["TOP_LEFT",  "TOP_RIGHT"],    "pitches")
        p_max = med(["BOTTOM_LEFT","BOTTOM_RIGHT"],"pitches")

        y_min, y_max = min(y_min, y_max), max(y_min, y_max)
        p_min, p_max = min(p_min, p_max), max(p_min, p_max)

        # Step 2 — re-anchor with CENTER reading
        if "CENTER" in buf:
            c_yaw   = float(np.median(buf["CENTER"]["yaws"]))
            c_pitch = float(np.median(buf["CENTER"]["pitches"]))
            # Expand whichever bound is closest to center so center always fits
            y_min = min(y_min, c_yaw)
            y_max = max(y_max, c_yaw)
            p_min = min(p_min, c_pitch)
            p_max = max(p_max, c_pitch)

        # Step 3 — minimum span, re-centred if expanded
        y_center = (y_min + y_max) / 2.0
        p_center = (p_min + p_max) / 2.0

        y_span = max(y_max - y_min, MIN_YAW_SPAN)
        p_span = max(p_max - p_min, MIN_PITCH_SPAN)

        y_min = y_center - y_span / 2.0
        y_max = y_center + y_span / 2.0
        p_min = p_center - p_span / 2.0
        p_max = p_center + p_span / 2.0

        # Step 4 — leniency expansion
        self.safe_zone = {
            "yaw_min":   y_min - y_span * YAW_LENIENCY,
            "yaw_max":   y_max + y_span * YAW_LENIENCY,
            "pitch_min": p_min - p_span * PITCH_LENIENCY,
            "pitch_max": p_max + p_span * PITCH_LENIENCY,
        }

        self.is_calibrated = True
        print("✅ Calibration finalised:", self.safe_zone)
        print(f"   Raw spans  → yaw: {y_max - y_min:.3f}  pitch: {p_max - p_min:.3f}")
        print(f"   After pad  → yaw: [{self.safe_zone['yaw_min']:.3f}, {self.safe_zone['yaw_max']:.3f}]  "
              f"pitch: [{self.safe_zone['pitch_min']:.3f}, {self.safe_zone['pitch_max']:.3f}]")
        return self.safe_zone

    def set_calibration(self, safe_zone: dict):
        """Directly inject a pre-computed safe_zone (from /ws/monitor after calibration page)."""
        if safe_zone:
            self.safe_zone     = safe_zone
            self.is_calibrated = True
            print("🎯 Safe zone injected:", safe_zone)
        else:
            print("⚠️ Empty safe zone received — calibration not set.")

    # ── Proctoring prediction ──────────────────────────────────────────────────

    def predict(self, frame):
        """
        Returns (status, pitch, yaw).

        Status values:
            NO_FACE        — no face detected in this frame
            NOT_CALIBRATED — face found but safe zone not yet set
            FOCUSED        — gaze inside calibrated safe zone
            LOOKING_LEFT / LOOKING_RIGHT / LOOKING_UP / LOOKING_DOWN

        Design principles
        ─────────────────
        • Frame is flipped here — same as add_calibration_frame — so both
          always measure the same orientation (prevents mirror-image mismatch).
        • NO internal timing or strike logic. All of that lives in main.py
          (/ws/monitor) where wall-clock time is available. Keeping timing
          out of here makes both sides independently testable.
        • A small majority-vote window (HISTORY_SIZE=3) suppresses single-frame
          noise at 1 fps without introducing enough lag to miss real gaze shifts.
        """
        flipped    = cv2.flip(frame, 1)
        pitch, yaw = self._compute_gaze(flipped)

        if pitch is None:
            self.gaze_history = []
            return "NO_FACE", 0.0, 0.0

        if not self.is_calibrated:
            return "NOT_CALIBRATED", float(pitch), float(yaw)

        sz = self.safe_zone

        if   yaw   < sz["yaw_min"]:   raw = "LOOKING_LEFT"
        elif yaw   > sz["yaw_max"]:   raw = "LOOKING_RIGHT"
        elif pitch < sz["pitch_min"]: raw = "LOOKING_UP"
        elif pitch > sz["pitch_max"]: raw = "LOOKING_DOWN"
        else:                         raw = "FOCUSED"

        # Majority vote — suppresses single-frame flicker
        self.gaze_history.append(raw)
        if len(self.gaze_history) > HISTORY_SIZE:
            self.gaze_history.pop(0)

        stable = max(set(self.gaze_history), key=self.gaze_history.count)
        return stable, float(pitch), float(yaw)