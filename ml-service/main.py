import cv2
import time
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from core.object_detector import ObjectDetector
from core.gaze_tracker import GazeTracker
from core.audio_proctor import AudioProctor

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize models separately so a failure in one doesn't kill the others
detector = None
gaze_tracker = None
audio_module = None

try:
    detector = ObjectDetector("models/best.pt") # Update path if needed
    print("✅ Object Detector loaded.")
except Exception as e:
    print(f"❌ Object Detector failed to load: {e}")

try:
    # Loads the new strict dynamic-calibration tracker
    gaze_tracker = GazeTracker()
    print("✅ Gaze Tracker loaded.")
except Exception as e:
    print(f"❌ Gaze Tracker failed to load: {e}")

try:
    audio_module = AudioProctor()
    audio_module.start_listening()
    print("✅ Audio Proctor loaded and listening.")
except Exception as e:
    print(f"❌ Audio Proctor failed to load: {e}")


# Safely release the microphone when you stop the FastAPI server
@app.on_event("shutdown")
def shutdown_event():
    if audio_module:
        print("Shutting down Audio Module...")
        audio_module.stop_listening()


# How many continuous seconds of looking away before a GAZE_STRIKE is issued
GAZE_STRIKE_THRESHOLD_SECONDS = 5


@app.websocket("/ws/monitor")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print(f"🔌 Client Connected: {websocket.client}")

    exam_id = websocket.query_params.get("examId", "unknown")
    print(f"📋 Session Started: examId={exam_id}")

    # Per-connection gaze timer state
    gaze_away_since = None
    gaze_strike_issued = False

    try:
        while True:
            # 1. Receive Frame (Bytes)
            data = await websocket.receive_bytes()

            # 2. Decode Image
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if frame is None:
                continue

            # 3. Determine Status
            status = "clean"
            alerts = []
            analysis = {}
            obj_analysis = {}

            # ── Object Detection ───────────────────────────────────────────────
            if detector is not None:
                # Optional: Add brightness boost here if low-light is still an issue
                obj_analysis = detector.predict(frame)
                analysis.update(obj_analysis)

                if obj_analysis.get('phone_detected'):
                    status = "violation"
                    alerts.append("PHONE_DETECTED")

                if obj_analysis.get('person_count', 0) > 1:
                    status = "violation"
                    alerts.append("MULTIPLE_PERSONS")

                #if obj_analysis.get('person_count', 0) == 0:
                 #   if status == "clean":
                  #      status = "warning"
                   # alerts.append("NO_FACE_DETECTED")

            # ── Gaze Tracking ──────────────────────────────────────────────────
            if gaze_tracker is not None:
                gaze_direction, pitch, yaw = gaze_tracker.predict(frame)

                analysis['gaze_direction'] = gaze_direction
                analysis['pitch'] = round(pitch, 2)
                analysis['yaw'] = round(yaw, 2)

                # ⭐ NEW: Handle the silent 2-second calibration phase
                if gaze_direction == "CALIBRATING":
                    alerts.append("GAZE_CALIBRATING")
                
                # Handle strict wandering eyes
                elif gaze_direction in ["LOOKING_LEFT", "LOOKING_RIGHT", "LOOKING_DOWN", "LOOKING_UP"]:
                    if status == "clean":
                        status = "warning"
                    alerts.append(f"SUSPICIOUS_GAZE: {gaze_direction}")

                    now = time.time()
                    if gaze_away_since is None:
                        gaze_away_since = now
                        gaze_strike_issued = False

                    seconds_away = now - gaze_away_since

                    if seconds_away >= GAZE_STRIKE_THRESHOLD_SECONDS and not gaze_strike_issued:
                        status = "violation"
                        alerts.append("GAZE_STRIKE")
                        gaze_strike_issued = True

                else:
                    # Reset timer when user looks back (FOCUSED)
                    if gaze_direction == "FOCUSED":
                        gaze_away_since = None
                        gaze_strike_issued = False

                # Handle Face Not Visible specifically for Gaze Module
                if gaze_direction == "NO_FACE" and obj_analysis.get('person_count', 0) > 0:
                    if status == "clean":
                        status = "warning"
                    alerts.append("FACE_NOT_VISIBLE")

            # ── Audio Monitoring ───────────────────────────────────────────────
            if audio_module is not None:
                current_audio_label = audio_module.audio_label
                analysis['audio_status'] = current_audio_label

                if "Speech Detected" in current_audio_label:
                    status = "violation"
                    alerts.append("SPEECH_DETECTED")
            else:
                analysis['audio_status'] = "Offline"


            # 4. Send Response to Frontend
            await websocket.send_json({
                "status": status,
                "alerts": alerts,
                "data": analysis
            })

    except WebSocketDisconnect:
        print("🔌 Client Disconnected")
        # Reset the gaze tracker's calibration state so the next user gets a fresh calibration!
        if gaze_tracker:
            gaze_tracker.is_calibrated = False
            gaze_tracker.calibration_data = {'LEFT': [], 'RIGHT': [], 'UP': [], 'DOWN': []}

    except Exception as e:
        print(f"⚠️ Error processing frame: {e}")
        try:
            await websocket.close()
        except:
            pass