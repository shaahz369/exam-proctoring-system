import cv2
import time
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from core.object_detector import ObjectDetector
from core.gaze_tracker import GazeTracker
from core.behavior_analyzer import BehaviorAnalyzer, encode_frame_features

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize models separately so a failure in one doesn't kill the other
detector = None
gaze_tracker = None
behavior_analyzer = None

try:
    detector = ObjectDetector("models/best.pt")
    print("✅ Object Detector loaded.")
except Exception as e:
    print(f"❌ Object Detector failed to load: {e}")

try:
    gaze_tracker = GazeTracker()
    print("✅ Gaze Tracker loaded.")
except Exception as e:
    print(f"❌ Gaze Tracker failed to load: {e}")

try:
    behavior_analyzer = BehaviorAnalyzer()
    print("✅ Behavior Analyzer loaded.")
except Exception as e:
    print(f"❌ Behavior Analyzer failed to load: {e}")

# How many continuous seconds of looking away before a GAZE_STRIKE is issued
GAZE_STRIKE_THRESHOLD_SECONDS = 5

# In-memory store for behavior analysis results
# Key: (examId, candidateId) → prediction dict
behavior_results = {}


@app.websocket("/ws/monitor")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print(f"🔌 Client Connected: {websocket.client}")

    # ── Parse session identifiers from query params ──
    exam_id = websocket.query_params.get("examId", "unknown")
    candidate_id = websocket.query_params.get("candidateId", "unknown")
    print(f"📋 Session: examId={exam_id}, candidateId={candidate_id}")

    # Per-connection gaze timer state — resets on every new WS connection
    gaze_away_since = None
    gaze_strike_issued = False

    # Per-connection feature buffer for LSTM behavioral analysis
    feature_buffer = []

    try:
        while True:
            # 1. Receive Frame (Bytes)
            data = await websocket.receive_bytes()

            # 2. Decode Image
            nparr = np.frombuffer(data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if frame is None:
                continue

            # 4. Determine Status
            status = "clean"
            alerts = []

            # ── Object Detection ───────────────────────────────────────────────
            if detector is not None:
                analysis = detector.predict(frame)

                if analysis.get('phone_detected'):
                    status = "violation"
                    alerts.append("PHONE_DETECTED")

                if analysis.get('person_count', 0) > 1:
                    status = "violation"
                    alerts.append("MULTIPLE_PERSONS")

                if analysis.get('person_count', 0) == 0:
                    if status == "clean":
                        status = "warning"
                    alerts.append("NO_FACE_DETECTED")
            else:
                analysis = {}

            # ── Gaze Tracking ──────────────────────────────────────────────────
            if gaze_tracker is not None:
                gaze_direction, pitch, yaw = gaze_tracker.predict(frame)

                # Attach gaze data to analysis payload
                analysis['gaze_direction'] = gaze_direction
                analysis['pitch'] = round(pitch, 2)
                analysis['yaw'] = round(yaw, 2)

                if gaze_direction in ["LOOKING_LEFT", "LOOKING_RIGHT", "LOOKING_DOWN", "LOOKING_UP"]:
                    # Immediate warning every frame (original behavior)
                    if status == "clean":
                        status = "warning"
                    alerts.append(f"SUSPICIOUS_GAZE: {gaze_direction}")

                    # 5-second strike timer (additive)
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
                    # Reset timer when user looks back
                    if gaze_direction == "FOCUSED":
                        gaze_away_since = None
                        gaze_strike_issued = False

                # FACE_NOT_VISIBLE — kept outside if/else (same as original)
                if gaze_direction == "NO_FACE" and analysis.get('person_count', 0) > 0:
                    if status == "clean":
                        status = "warning"
                    alerts.append("FACE_NOT_VISIBLE")

            # ── Accumulate features for LSTM ───────────────────────────────────
            features = encode_frame_features(analysis)
            feature_buffer.append(features)

            # 5. Send Response
            await websocket.send_json({
                "status": status,
                "alerts": alerts,
                "data": analysis
            })

    except WebSocketDisconnect:
        print("🔌 Client Disconnected")
    except Exception as e:
        print(f"⚠️ Error processing frame: {e}")
        try:
            await websocket.close()
        except:
            pass

    # ── Run LSTM analysis on disconnect ────────────────────────────────────
    if behavior_analyzer is not None and len(feature_buffer) > 0:
        try:
            prediction = behavior_analyzer.predict(feature_buffer)
            behavior_results[(exam_id, candidate_id)] = prediction
            print(f"🧠 Behavior analysis for ({exam_id}, {candidate_id}): "
                  f"risk={prediction['risk_level']}, confidence={prediction['confidence']}")
        except Exception as e:
            print(f"⚠️ Behavior analysis failed: {e}")
    else:
        print(f"⚠️ Skipped behavior analysis: analyzer={'loaded' if behavior_analyzer else 'missing'}, frames={len(feature_buffer)}")


# ── REST endpoint for behavior report ──────────────────────────────────────────
@app.get("/api/behavior-report/{exam_id}/{candidate_id}")
async def get_behavior_report(exam_id: str, candidate_id: str):
    """
    Returns the LSTM behavior analysis result for a specific candidate in an exam.
    Called by the frontend after exam submission.
    """
    key = (exam_id, candidate_id)
    result = behavior_results.get(key)

    if result is None:
        raise HTTPException(status_code=404, detail="No behavior report found for this session.")

    return JSONResponse(content=result)