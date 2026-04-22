# main.py
import cv2
import time
import json
import base64
import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from core.object_detector import ObjectDetector
from core.gaze_tracker     import GazeTracker
from core.audio_proctor    import AudioProctor

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load models ───────────────────────────────────────────────────────────────

detector     = None
gaze_tracker = None
audio_module = None

try:
    detector = ObjectDetector("models/best.pt")
    print("✅ Object Detector loaded.")
except Exception as e:
    print(f"❌ Object Detector failed: {e}")

try:
    gaze_tracker = GazeTracker()
    print("✅ Gaze Tracker loaded.")
except Exception as e:
    print(f"❌ Gaze Tracker failed: {e}")

try:
    audio_module = AudioProctor()
    audio_module.start_listening()
    print("✅ Audio Proctor running.")
except Exception as e:
    print(f"❌ Audio Proctor failed: {e}")


@app.on_event("shutdown")
def shutdown_event():
    if audio_module:
        audio_module.stop_listening()


# ── Gaze timing constants ─────────────────────────────────────────────────────
#
# Total time looking away before a GAZE_STRIKE fires.
# GazeTracker.warning_delay is now 0 — all timing lives here.
#
GAZE_STRIKE_THRESHOLD_SECONDS = 5   # ✅ was 3 — gives students more grace time
                                     #    and reduces false positives from brief glances

# Frontend countdown warning starts this many seconds before the strike.
GAZE_WARNING_LEAD_SECONDS = 3       # ✅ was 2 — student sees countdown for longer

# Minimum good frames required per calibration point
MIN_FRAMES_PER_POINT = 15


# ─────────────────────────────────────────────────────────────────────────────
# Shared safe WebSocket send helper
# ─────────────────────────────────────────────────────────────────────────────

async def safe_send(websocket: WebSocket, data: dict) -> bool:
    try:
        await websocket.send_json(data)
        return True
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# /ws/calibrate
# ─────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/calibrate")
async def calibrate_endpoint(websocket: WebSocket):
    await websocket.accept()
    print(f"🔌 Calibration session started: {websocket.client}")

    if gaze_tracker is None:
        await safe_send(websocket, {"type": "ERROR", "detail": "Gaze model not loaded."})
        await websocket.close()
        return

    gaze_tracker.reset_calibration()

    try:
        while True:
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                print("🔌 Calibration client disconnected during receive")
                break

            if "text" not in message:
                continue

            try:
                msg = json.loads(message["text"])
            except Exception:
                continue

            msg_type = msg.get("type")

            # ── Frame with base64 image ───────────────────────────────────
            if msg_type == "FRAME":
                point_id = msg.get("label")
                img_data = msg.get("image")

                if not point_id or not img_data:
                    continue

                try:
                    _, encoded = img_data.split(",", 1)
                    nparr = np.frombuffer(base64.b64decode(encoded), np.uint8)
                    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                except Exception as e:
                    print(f"⚠️ Frame decode error: {e}")
                    continue

                if frame is None:
                    continue

                face_detected, pitch, yaw = gaze_tracker.add_calibration_frame(
                    frame, point_id
                )
                collected = len(
                    gaze_tracker.calib_buffer.get(point_id, {}).get("pitches", [])
                )
                print(f"📸 {point_id} → {collected} frames")

                sent = await safe_send(websocket, {
                    "type":          "FRAME_ACK",
                    "face_detected": face_detected,
                    "pitch":         round(pitch, 4),
                    "yaw":           round(yaw,   4),
                    "point_id":      point_id,
                    "collected":     collected,
                })
                if not sent:
                    break

            # ── Finalise ──────────────────────────────────────────────────
            elif msg_type == "FINALIZE":
                expected = {
                    "TOP_LEFT", "TOP_RIGHT",
                    "BOTTOM_LEFT", "BOTTOM_RIGHT",
                    "CENTER",
                }
                missing = [
                    pt for pt in expected
                    if len(gaze_tracker.calib_buffer
                           .get(pt, {})
                           .get("pitches", [])) < MIN_FRAMES_PER_POINT
                ]

                if missing:
                    await safe_send(websocket, {
                        "type":   "ERROR",
                        "detail": f"Insufficient data for: {', '.join(missing)}. "
                                  "Please redo calibration.",
                    })
                    continue

                safe_zone = gaze_tracker.finalize_calibration()
                await safe_send(websocket, {
                    "type":      "CALIBRATION_COMPLETE",
                    "safe_zone": safe_zone,
                })
                break

    except Exception as e:
        print(f"⚠️ Calibration unexpected error: {e}")
        await safe_send(websocket, {"type": "ERROR", "detail": str(e)})

    finally:
        gaze_tracker.reset_calibration()
        print("🔌 Calibration session ended")


# ─────────────────────────────────────────────────────────────────────────────
# /ws/monitor  — live proctoring, backend owns ALL gaze timing
# ─────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/monitor")
async def monitor_endpoint(websocket: WebSocket):
    await websocket.accept()
    exam_id = websocket.query_params.get("examId", "unknown")
    print(f"🔌 Monitor session started: examId={exam_id}")

    if gaze_tracker:
        gaze_tracker.reset_calibration()

    # Per-session gaze timer state
    gaze_away_since    = None   # wall-clock time when continuous away started
    gaze_strike_issued = False  # True once GAZE_STRIKE has fired for this episode

    try:
        while True:
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                print(f"🔌 Monitor client disconnected: examId={exam_id}")
                break

            # ── Text / control messages ───────────────────────────────────
            if "text" in message:
                try:
                    msg = json.loads(message["text"])
                except Exception:
                    continue

                if msg.get("type") == "SET_CALIBRATION" and gaze_tracker is not None:
                    safe_zone = msg.get("safe_zone", {})
                    if safe_zone:
                        gaze_tracker.set_calibration(safe_zone)
                        print(f"✅ Calibration injected: examId={exam_id} → {safe_zone}")
                        await safe_send(websocket, {"type": "CALIBRATION_ACK"})
                continue

            # ── Binary frame ──────────────────────────────────────────────
            if "bytes" not in message:
                continue

            nparr = np.frombuffer(message["bytes"], np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            status       = "clean"
            alerts       = []
            analysis     = {}
            obj_analysis = {}

            # ── Object detection ──────────────────────────────────────────
            if detector is not None:
                try:
                    obj_analysis = detector.predict(frame)
                    analysis.update(obj_analysis)

                    if obj_analysis.get("phone_detected"):
                        status = "violation"
                        alerts.append("PHONE_DETECTED")

                    if obj_analysis.get("person_count", 0) > 1:
                        status = "violation"
                        alerts.append("MULTIPLE_PERSONS")
                except Exception as e:
                    print(f"⚠️ Object detection error: {e}")

            # ── Gaze tracking ─────────────────────────────────────────────
            if gaze_tracker is not None:
                try:
                    if not gaze_tracker.is_calibrated:
                        alerts.append("GAZE_NOT_CALIBRATED")
                        if status == "clean":
                            status = "warning"
                    else:
                        direction, pitch, yaw = gaze_tracker.predict(frame)

                        analysis["gaze_direction"] = direction
                        analysis["pitch"]          = round(float(pitch), 4)
                        analysis["yaw"]            = round(float(yaw),   4)

                        away = {
                            "LOOKING_LEFT", "LOOKING_RIGHT",
                            "LOOKING_UP",   "LOOKING_DOWN",
                        }

                        if direction in away:
                            now = time.time()

                            # Start the clock on the first away-frame
                            if gaze_away_since is None:
                                gaze_away_since    = now
                                gaze_strike_issued = False

                            elapsed = now - gaze_away_since

                            if status == "clean":
                                status = "warning"
                            alerts.append("SUSPICIOUS_GAZE")

                            # ── Countdown phase ───────────────────────────
                            warning_start = (
                                GAZE_STRIKE_THRESHOLD_SECONDS
                                - GAZE_WARNING_LEAD_SECONDS
                            )
                            if elapsed >= warning_start and not gaze_strike_issued:
                                seconds_left = max(
                                    0,
                                    int(GAZE_STRIKE_THRESHOLD_SECONDS - elapsed)
                                )
                                alerts.append(f"GAZE_COUNTDOWN: {seconds_left}")
                                analysis["gaze_seconds_left"] = seconds_left

                            # ── Strike — fires once per away episode ──────
                            if (elapsed >= GAZE_STRIKE_THRESHOLD_SECONDS
                                    and not gaze_strike_issued):
                                status = "violation"
                                alerts.append("GAZE_STRIKE")
                                gaze_strike_issued = True
                                # ✅ FIX: reset timer after strike so next away
                                # starts a fresh episode — prevents double-strike
                                # on the very next frame (elapsed still >= threshold)
                                gaze_away_since = time.time()
                                print(
                                    f"🚨 GAZE_STRIKE: examId={exam_id} "
                                    f"after {elapsed:.1f}s"
                                )

                        elif direction == "FOCUSED":
                            # ✅ Reset timer only when truly focused
                            gaze_away_since    = None
                            gaze_strike_issued = False

                        # ── Face visible but gaze undetectable ───────────
                        if (direction == "NO_FACE"
                                and obj_analysis.get("person_count", 0) > 0):
                            if status == "clean":
                                status = "warning"
                            alerts.append("FACE_NOT_VISIBLE")

                        # ── No face + no person = NO_FACE_DETECTED ────────
                        if (direction == "NO_FACE"
                                and obj_analysis.get("person_count", 0) == 0):
                            if status == "clean":
                                status = "warning"
                            alerts.append("NO_FACE_DETECTED")

                except Exception as e:
                    print(f"⚠️ Gaze tracking error: {e}")

            # ── Audio ─────────────────────────────────────────────────────
            if audio_module is not None:
                try:
                    label = audio_module.audio_label
                    analysis["audio_status"] = label
                    if "Speech" in label:
                        status = "violation"
                        alerts.append("SPEECH_DETECTED")
                except Exception as e:
                    print(f"⚠️ Audio error: {e}")
                    analysis["audio_status"] = "Error"
            else:
                analysis["audio_status"] = "Offline"

            # ── Determine final status ────────────────────────────────────
            # Upgrade "clean" to "ok" for frontend clarity
            if not alerts:
                status = "ok"

            # ── Send result ───────────────────────────────────────────────
            sent = await safe_send(websocket, {
                "status": status,
                "alerts": alerts,
                "data":   analysis,
            })
            if not sent:
                print(f"🔌 Monitor send failed, closing: examId={exam_id}")
                break

    except Exception as e:
        if "disconnect" in str(e).lower() or "receive" in str(e).lower():
            print(f"👋 Normal disconnect: examId={exam_id}")
        else:
            print(f"⚠️ Monitor unexpected error: examId={exam_id} → {e}")

    finally:
        if gaze_tracker:
            gaze_tracker.reset_calibration()
        print(f"🔌 Monitor session ended: examId={exam_id}")