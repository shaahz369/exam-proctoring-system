// ExamTakerPage.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import {
  ClockIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon
} from "@heroicons/react/24/outline";

const API_BASE_URL = "http://localhost:5000/api/exams";
const PROCTOR_API  = "http://localhost:5000/api/proctor/log";
const ML_WS_URL    = "ws://localhost:8000/ws/monitor";
const MAX_STRIKES  = 3;

const HARD_VIOLATION_DEBOUNCE_MS = 10000; // 10 s
const GAZE_STRIKE_DEBOUNCE_MS    = 5000;  //  5 s

const ExamTakerPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const examCode        = location.state?.examCode        || sessionStorage.getItem("examCode");
  const calibrationData = location.state?.calibrationData || null;

  const fullscreenRef = useRef(null);
  const videoRef      = useRef(null);
  const wsRef         = useRef(null);
  const canvasRef     = useRef(document.createElement("canvas"));

  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const startCalledRef  = useRef(false);
  const blurTimeoutRef  = useRef(null);
  const alertTimeoutRef = useRef(null);

  // Stable refs — always hold latest value, safe to read inside any closure
  const examRef    = useRef(null);
  const answersRef = useRef({});

  // DB debounce refs
  const lastPhoneLogRef           = useRef(0);
  const lastMultiplePersonsLogRef = useRef(0);
  const lastNoFaceLogRef          = useRef(0);
  const lastSpeechLogRef          = useRef(0);
  const lastGazeStrikeLogRef      = useRef(0);

  const proctoringActiveRef  = useRef(false);
  const isSubmittedRef       = useRef(false);
  // ✅ Tracks latest strike count locally so debounce can be bypassed when over limit
  const currentStrikesRef    = useRef(0);

  // ✅ FIX: ref to always hold the latest handleViolation so closures never go stale
  const handleViolationRef = useRef(null);

  const [exam,                 setExam]                 = useState(null);
  const [answers,              setAnswers]              = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timeLeft,             setTimeLeft]             = useState(0);
  const [loading,              setLoading]              = useState(true);
  const [error,                setError]                = useState(null);
  const [isSubmitted,          setIsSubmitted]          = useState(false);
  const [isFullscreen,         setIsFullscreen]         = useState(false);
  const [mlAlert,              setMlAlert]              = useState(null);
  const [mlAlertType,          setMlAlertType]          = useState("warning");
  const [gazeCountdown,        setGazeCountdown]        = useState(null);

  // Keep refs in sync with state
  useEffect(() => { examRef.current    = exam;    }, [exam]);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  /* =========================
     TIMED ALERT HELPER
  ========================= */
  const showTimedAlert = (message, type = "warning") => {
    setMlAlertType(type);
    setMlAlert(message);
    if (alertTimeoutRef.current) clearTimeout(alertTimeoutRef.current);
    alertTimeoutRef.current = setTimeout(() => setMlAlert(null), 2500);
  };

  /* =========================
     CAMERA
  ========================= */
  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    cameraStreamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject   = stream;
      videoRef.current.muted       = true;
      videoRef.current.playsInline = true;
      try { await videoRef.current.play(); }
      catch (err) { if (err.name !== "AbortError") throw err; }
    }
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
  };

  /* =========================
     SCREEN SHARE
  ========================= */
  const startScreenShare = async () => {
    const stream   = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track    = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    if (settings.displaySurface !== "monitor") {
      stream.getTracks().forEach(t => t.stop());
      throw new Error("You must share the entire screen.");
    }
    screenStreamRef.current = stream;
    // ✅ FIX: use handleViolationRef so closure always has the latest function
    track.onended = () => {
      if (proctoringActiveRef.current) handleViolationRef.current("SCREEN_SHARE_STOPPED");
    };
  };

  const stopScreenShare = () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
  };

  /* =========================
     SUBMIT
  ========================= */
  const handleSubmit = async (timeout) => {
    if (isSubmittedRef.current) return;
    isSubmittedRef.current = true;
    setIsSubmitted(true);

    const currentExam    = examRef.current;
    const currentAnswers = answersRef.current;
    if (!currentExam) return;

    const token = localStorage.getItem("authToken");
    try {
      await axios.post(
        "http://localhost:5000/api/submissions",
        {
          examId: currentExam._id,
          answers: Object.entries(currentAnswers).map(([q, a]) => ({
            questionId: q,
            answer: a.trim(),
          })),
          timeout,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error("Submit error:", err);
    }

    stopCamera();
    stopScreenShare();
    wsRef.current?.close();
    sessionStorage.removeItem("examCode");
    alert("Exam submitted successfully.");
    navigate("/dashboard");
  };

  /* =========================
     VIOLATIONS
  ========================= */
  const handleViolation = async (type) => {
    const currentExam = examRef.current;
    if (!currentExam || isSubmittedRef.current) return;
    if (!proctoringActiveRef.current && type !== "EXIT_FULLSCREEN") return;

    // ✅ FIX: if we already know strikes are at/over limit locally, submit immediately
    // without waiting for another debounce-gated API call
    if (currentStrikesRef.current >= MAX_STRIKES) {
      console.log(`🚨 Local strike count ${currentStrikesRef.current} >= ${MAX_STRIKES}, forcing submit`);
      alert(`Maximum violations reached. Your exam will now be submitted.`);
      handleSubmit(true);
      return;
    }

    try {
      const token = localStorage.getItem("authToken");
      const res = await axios.post(
        PROCTOR_API,
        { examId: currentExam._id, type },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const strikes = res.data.strikes;
      currentStrikesRef.current = strikes; // ✅ always keep local ref in sync
      console.log(`⚠️ Violation: ${type} | Strikes: ${strikes}/${MAX_STRIKES}`);

      if (strikes >= MAX_STRIKES) {
        alert(`Maximum violations reached (${strikes}/${MAX_STRIKES}). Your exam will now be submitted.`);
        handleSubmit(true);
      } else {
        const silentTypes = [
          "SUSPICIOUS_GAZE", "FACE_NOT_VISIBLE", "WINDOW_BLUR",
          "GAZE_STRIKE",     "PHONE_DETECTED",   "MULTIPLE_PERSONS",
          "NO_FACE_DETECTED","SPEECH_DETECTED",
        ];
        if (!silentTypes.some(s => type.includes(s))) {
          warning(`⚠️ System Violation: ${type} (${strikes}/${MAX_STRIKES} strikes)`);
        }
      }
    } catch (err) {
      console.error("Violation log error:", err);
    }
  };

  // ✅ FIX: keep handleViolationRef always pointing to the latest handleViolation
  handleViolationRef.current = handleViolation;

  /* =========================
     ML SERVICE INTEGRATION
  ========================= */
  const startMLMonitoring = () => {
    const currentExam = examRef.current;
    const wsUrl = currentExam?._id
      ? `${ML_WS_URL}?examId=${currentExam._id}`
      : ML_WS_URL;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log("✅ WebSocket Connected to ML Service");
      if (calibrationData) {
        wsRef.current.send(JSON.stringify({
          type:      "SET_CALIBRATION",
          safe_zone: calibrationData,
        }));
        console.log("📐 Calibration sent:", calibrationData);
      } else {
        console.warn("⚠️ No calibration data — gaze tracking inactive.");
      }
    };

    wsRef.current.onmessage = (event) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const response = JSON.parse(event.data);

      if (response.type === "CALIBRATION_ACK") {
        console.log("✅ Calibration acknowledged.");
        return;
      }

      if (response.status === "violation" || response.status === "warning") {
        const alerts = response.alerts || [];
        const now = Date.now();

        // ── Extract flags ──────────────────────────────────────────
        const isFaceMissing      = alerts.some(a => a.includes("FACE_NOT_VISIBLE"));
        const isNoFace           = alerts.includes("NO_FACE_DETECTED");
        const hasPhoneDetected   = alerts.includes("PHONE_DETECTED");
        const hasMultiplePersons = alerts.includes("MULTIPLE_PERSONS");
        const hasSpeech          = alerts.includes("SPEECH_DETECTED");
        const hasGazeStrike      = alerts.includes("GAZE_STRIKE");
        const hasSuspiciousGaze  = alerts.some(a => a.startsWith("SUSPICIOUS_GAZE"));

        const countdownAlert = alerts.find(a => a.startsWith("GAZE_COUNTDOWN:"));
        const countdownValue = countdownAlert
          ? parseInt(countdownAlert.split(":")[1].trim(), 10)
          : null;

        // ── 1. UI ALERTS ───────────────────────────────────────────
        const displayAlerts = [];
        if (hasPhoneDetected)   displayAlerts.push("Cell phone detected!");
        if (hasMultiplePersons) displayAlerts.push("Multiple people detected!");
        if (hasSpeech)          showTimedAlert("Talking/Speech detected!","warning");
        if (hasGazeStrike)      displayAlerts.push("⚠️ Continuous gaze violation!");

        if (displayAlerts.length > 0) {
          showTimedAlert(displayAlerts.join(" | "), "violation");
          setGazeCountdown(null);
        } else if (isNoFace || isFaceMissing) {
          showTimedAlert("Face not visible. Please stay in front of the camera.", "warning");
        } else if (countdownValue !== null) {
          setGazeCountdown(countdownValue);
          showTimedAlert(`Please focus on your screen! Strike in ${countdownValue}s`, "warning");
        } else if (hasSuspiciousGaze) {
          setGazeCountdown(null);
          showTimedAlert("Please focus on your screen!", "warning");
        }

        // ── 2. DB LOGGING — use handleViolationRef to avoid stale closure ──
        // ✅ FIX: bypass debounce entirely if strikes already at/over limit
        const overLimit = currentStrikesRef.current >= MAX_STRIKES;

        if (hasPhoneDetected && (overLimit || now - lastPhoneLogRef.current > HARD_VIOLATION_DEBOUNCE_MS)) {
          lastPhoneLogRef.current = now;
          handleViolationRef.current("PHONE_DETECTED");
        }
        if (hasMultiplePersons && (overLimit || now - lastMultiplePersonsLogRef.current > HARD_VIOLATION_DEBOUNCE_MS)) {
          lastMultiplePersonsLogRef.current = now;
          handleViolationRef.current("MULTIPLE_PERSONS");
        }
        if ((isNoFace || isFaceMissing) && (overLimit || now - lastNoFaceLogRef.current > HARD_VIOLATION_DEBOUNCE_MS)) {
          lastNoFaceLogRef.current = now;
          handleViolationRef.current("NO_FACE_DETECTED");
        }
        if (hasSpeech && (overLimit || now - lastSpeechLogRef.current > HARD_VIOLATION_DEBOUNCE_MS)) {
          lastSpeechLogRef.current = now;
          // handleViolationRef.current("SPEECH_DETECTED");
        }
        if (hasGazeStrike && (overLimit || now - lastGazeStrikeLogRef.current > GAZE_STRIKE_DEBOUNCE_MS)) {
          lastGazeStrikeLogRef.current = now;
          handleViolationRef.current("GAZE_STRIKE");
          console.log("🚨 MAIN GAZE_STRIKE logged to database");
        }

      } else {
        // status is "ok" or "success" — clear UI
        setMlAlert(null);
        setGazeCountdown(null);
      }
    };

    wsRef.current.onerror = (err) => console.error("❌ ML WS Error:", err);
    wsRef.current.onclose = () => {
      console.log("🔌 ML WS Closed");
      setMlAlert(null);
    };

    const intervalId = setInterval(() => sendFrameToML(), 1000);
    return () => {
      clearInterval(intervalId);
      wsRef.current?.close();
    };
  };

  const sendFrameToML = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!videoRef.current || videoRef.current.videoWidth === 0) return;

    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(blob);
      }
    }, "image/jpeg", 0.7);
  };

  /* =========================
     FULLSCREEN + START
  ========================= */
  const startProctoredExam = async () => {
    try {
      stopCamera();
      stopScreenShare();
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }

      await startCamera();
      await startScreenShare();
      await fullscreenRef.current.requestFullscreen();
      setIsFullscreen(true);

      // ✅ FIX: reduced from 2000ms to 500ms so early violations aren't silently ignored
      setTimeout(() => {
        proctoringActiveRef.current = true;
        console.log("✅ Proctoring active");
      }, 500);

      startMLMonitoring();
    } catch (err) {
      alert(err.message || "Permission denied");
      stopCamera();
      stopScreenShare();
    }
  };

  /* =========================
     FULLSCREEN EXIT
  ========================= */
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        if (examRef.current && !isSubmittedRef.current && proctoringActiveRef.current) {
          proctoringActiveRef.current = false;
          // ✅ FIX: use handleViolationRef so this closure is never stale
          handleViolationRef.current("EXIT_FULLSCREEN");
        }
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* =========================
     TAB / WINDOW DETECTION
  ========================= */
  useEffect(() => {
    if (!exam || isSubmitted) return;

    const handleHidden = () => {
      if (!proctoringActiveRef.current) return;
      if (document.visibilityState !== "visible") handleViolationRef.current("TAB_SWITCH"); // ✅ FIX
    };
    const handleBlur = () => {
      if (!proctoringActiveRef.current) return;
      blurTimeoutRef.current = setTimeout(
        () => handleViolationRef.current("WINDOW_BLUR"), // ✅ FIX
        1000
      );
    };
    const handleFocus = () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", handleHidden);
    window.addEventListener("blur",  handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleHidden);
      window.removeEventListener("blur",  handleBlur);
      window.removeEventListener("focus", handleFocus);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, [exam, isSubmitted]);

  /* =========================
     START EXAM
  ========================= */
  useEffect(() => {
    const startExam = async () => {
      const token = localStorage.getItem("authToken");
      if (!token || !examCode) { setError("Invalid exam entry."); setLoading(false); return; }
      if (startCalledRef.current) return;
      startCalledRef.current = true;

      try {
        const { data } = await axios.post(
          `${API_BASE_URL}/start`,
          { examCode },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        examRef.current    = data.exam;
        answersRef.current = {};
        data.exam.questions.forEach(q => (answersRef.current[q._id] = ""));

        setExam(data.exam);
        setTimeLeft(data.exam.duration * 60);
        setAnswers({ ...answersRef.current });
      } catch (err) {
        setError(err.message || "Failed to start exam.");
      } finally {
        setLoading(false);
      }
    };
    startExam();
    return () => {
      stopCamera();
      stopScreenShare();
      wsRef.current?.close();
    };
  }, [examCode]);

  /* =========================
     TIMER
  ========================= */
  useEffect(() => {
    if (!exam || isSubmitted || timeLeft <= 0) return;
    const t = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(t); handleSubmit(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [exam, isSubmitted]);

  /* =========================
     UI RENDER
  ========================= */
  const formatTime = useMemo(() => {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [timeLeft]);

  if (loading) return (
    <div className="h-screen flex items-center justify-center text-gray-500 text-lg">
      Loading…
    </div>
  );
  if (error) return (
    <div className="p-8 max-w-lg mx-auto mt-20 bg-red-100 rounded">
      <XMarkIcon className="w-6 h-6 inline mr-2 text-red-600" />
      <span className="text-red-700">{error}</span>
    </div>
  );

  const q = exam.questions[currentQuestionIndex];

  const alertConfig = {
    info: {
      bg: "bg-blue-500", border: "border-blue-500",
      shadow: "shadow-[0_0_20px_rgba(59,130,246,0.8)]",
      title: "SYSTEM INFO", icon: <InformationCircleIcon className="w-8 h-8" />,
    },
    warning: {
      bg: "bg-orange-500", border: "border-orange-500",
      shadow: "shadow-[0_0_20px_rgba(249,115,22,0.8)]",
      title: "WARNING", icon: <ExclamationTriangleIcon className="w-8 h-8" />,
    },
    violation: {
      bg: "bg-red-600", border: "border-red-500",
      shadow: "shadow-[0_0_20px_rgba(239,68,68,0.8)]",
      title: "PROCTORING ALERT", icon: <ExclamationTriangleIcon className="w-8 h-8" />,
    },
  };
  const currentConfig = alertConfig[mlAlertType] || alertConfig.warning;

  return (
    <div ref={fullscreenRef} className="min-h-screen bg-gray-50 relative">

      {/* ── ML Alert Overlay ── */}
      {mlAlert && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-pulse">
          <div className={`text-white px-6 py-4 rounded shadow-2xl flex items-center gap-3 border-4 border-white ${currentConfig.bg}`}>
            {currentConfig.icon}
            <div>
              <h3 className="font-bold text-lg">{currentConfig.title}</h3>
              <p>{mlAlert}</p>
            </div>
            {gazeCountdown !== null && mlAlertType === "warning" && (
              <div className="ml-4 flex-shrink-0 w-12 h-12 rounded-full bg-white bg-opacity-20 flex items-center justify-center border-4 border-white">
                <span className="text-xl font-extrabold">{gazeCountdown}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Fullscreen re-entry overlay ── */}
      {!isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-900 text-white gap-4">
          <ExclamationTriangleIcon className="w-12 h-12 text-yellow-400" />
          <p className="text-lg font-semibold text-yellow-300">FULL SCREEN REQUIRED</p>
          <button
            onClick={startProctoredExam}
            className="px-8 py-4 bg-indigo-600 rounded text-xl font-bold hover:bg-indigo-700 transition"
          >
            Return to Exam
          </button>
        </div>
      )}

      {/* ── Webcam preview ── */}
      <video
        ref={videoRef}
        className={`fixed bottom-4 right-4 w-48 h-36 bg-black rounded z-40 object-cover transition-all duration-300 ${
          mlAlert
            ? `border-4 ${currentConfig.border} ${currentConfig.shadow}`
            : "border border-gray-300"
        }`}
      />

      <div className="max-w-6xl mx-auto p-6">
        <div className="flex justify-between bg-white p-4 rounded shadow mb-6">
          <h1 className="text-2xl font-bold">{exam.title}</h1>
          <div className="font-mono text-lg flex items-center gap-2">
            <ClockIcon className="w-6 h-6 inline" /> {formatTime}
          </div>
        </div>

        <div className="bg-white p-6 rounded shadow">
          <h2 className="text-xl font-semibold mb-4">
            Question {currentQuestionIndex + 1} / {exam.questions.length}
          </h2>

          <p className="mb-4">{q.questionText}</p>

          {q.type === "mcq" && q.options.map((opt, i) => (
            <label key={i} className="block mb-2 cursor-pointer">
              <input
                type="radio"
                checked={answers[q._id] === opt}
                onChange={() => setAnswers(p => {
                  const next = { ...p, [q._id]: opt };
                  answersRef.current = next;
                  return next;
                })}
                className="mr-2"
              />
              {opt}
            </label>
          ))}

          {q.type === "text" && (
            <textarea
              rows="5"
              value={answers[q._id]}
              onChange={e => {
                const val = e.target.value;
                setAnswers(p => {
                  const next = { ...p, [q._id]: val };
                  answersRef.current = next;
                  return next;
                });
              }}
              className="w-full border p-2 rounded resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          )}

          <div className="flex justify-between mt-6">
            <button
              disabled={currentQuestionIndex === 0}
              onClick={() => setCurrentQuestionIndex(i => i - 1)}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeftIcon className="w-5 h-5 inline" /> Prev
            </button>
            <button
              disabled={currentQuestionIndex === exam.questions.length - 1}
              onClick={() => setCurrentQuestionIndex(i => i + 1)}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next <ChevronRightIcon className="w-5 h-5 inline" />
            </button>
          </div>

          <button
            onClick={() => handleSubmit(false)}
            className="mt-6 w-full bg-red-600 hover:bg-red-700 transition text-white py-3 rounded font-bold"
          >
            <CheckIcon className="w-5 h-5 inline mr-2" />
            Submit Exam
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExamTakerPage;