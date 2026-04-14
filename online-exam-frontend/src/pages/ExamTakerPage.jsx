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
const PROCTOR_API = "http://localhost:5000/api/proctor/log";
const ML_WS_URL = "ws://localhost:8000/ws/monitor";
const MAX_STRIKES = 3;

// Debounce limits to prevent logging 100 times per second
const HARD_VIOLATION_DEBOUNCE_MS = 10000; // 10 seconds
const GAZE_STRIKE_DEBOUNCE_MS = 5000; // 5 seconds for repeated gaze strikes

const ExamTakerPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const examCode = location.state?.examCode || sessionStorage.getItem("examCode");

  const fullscreenRef = useRef(null);
  const videoRef = useRef(null);

  // Refs for ML Service
  const wsRef = useRef(null);
  const canvasRef = useRef(document.createElement("canvas"));

  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const startCalledRef = useRef(false);

  // Debounce ref for WINDOW_BLUR
  const blurTimeoutRef = useRef(null);

  // DB Logging Debounce refs
  const lastPhoneLogRef = useRef(0);
  const lastMultiplePersonsLogRef = useRef(0);
  const lastNoFaceLogRef = useRef(0);
  const lastSpeechLogRef = useRef(0);
  const lastGazeStrikeLogRef = useRef(0);

  // ⭐ PROCTORING GATE
  const proctoringActiveRef = useRef(false);
  const isSubmittedRef = useRef(false);

  const [exam, setExam] = useState(null);
  const [answers, setAnswers] = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Clean UI Overlay States
  const [mlAlert, setMlAlert] = useState(null);
  const [mlAlertType, setMlAlertType] = useState("warning"); // "warning" | "violation" | "info"

  /* =========================
     ML SERVICE INTEGRATION
  ========================= */
  const startMLMonitoring = () => {
    console.log("🔄 Attempting to connect to ML Service...");

    const wsUrl = exam?._id ? `${ML_WS_URL}?examId=${exam._id}` : ML_WS_URL;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log("✅ WebSocket Connected to ML Service");
    };

    wsRef.current.onmessage = (event) => {
      const response = JSON.parse(event.data);

      if (response.status === "violation" || response.status === "warning") {
        const alerts = response.alerts || [];

        // --- 1. HANDLE CALIBRATION PHASE ---
        if (alerts.includes("GAZE_CALIBRATING")) {
          setMlAlertType("info");
          setMlAlert("CALIBRATING GAZE... Please look directly at the center of your screen.");
          return; // Skip checking other violations during setup
        }

        // --- 2. EXTRACT ALERTS ---
        const isFaceMissing = alerts.some(a => a.includes("FACE_NOT_VISIBLE"));
        const isNoFace = alerts.includes("NO_FACE_DETECTED");
        const hasPhoneDetected = alerts.includes("PHONE_DETECTED");
        const hasMultiplePersons = alerts.includes("MULTIPLE_PERSONS");
        const hasSpeech = alerts.includes("SPEECH_DETECTED");
        const hasGazeStrike = alerts.includes("GAZE_STRIKE");
        
        // Find specific directional gaze warning
        const specificGazeAlert = alerts.find(a => a.startsWith("SUSPICIOUS_GAZE"));

        // --- 3. UI ALERT LOGIC ---
        let displayAlerts = [];
        if (hasPhoneDetected) displayAlerts.push("Cell phone detected!");
        if (hasMultiplePersons) displayAlerts.push("Multiple people detected!");
        if (hasSpeech) displayAlerts.push("Talking/Speech detected!");
        if (hasGazeStrike) displayAlerts.push("Continuous Gaze Violation!");

        if (displayAlerts.length > 0) {
          setMlAlertType("violation");
          setMlAlert(displayAlerts.join(" | "));
        } else if (isNoFace || isFaceMissing) {
          setMlAlertType("warning");
          setMlAlert("Face not visible. Please stay in front of the camera.");
        } else if (specificGazeAlert) {
          // Immediate directional warning for Strict Mode
          let directionText = "Looking away!";
          if (specificGazeAlert.includes("LEFT")) directionText = "Looking Left! Please focus on your screen.";
          if (specificGazeAlert.includes("RIGHT")) directionText = "Looking Right! Please focus on your screen.";
          if (specificGazeAlert.includes("UP")) directionText = "Looking Up! Please focus on your screen.";
          if (specificGazeAlert.includes("DOWN")) directionText = "Looking Down! Please focus on your screen.";
          
          setMlAlertType("warning");
          setMlAlert(directionText);
        }

        // --- 4. DB LOGGING LOGIC ---
        const now = Date.now();
        
        if (hasPhoneDetected && now - lastPhoneLogRef.current > HARD_VIOLATION_DEBOUNCE_MS) {
          handleViolation("PHONE_DETECTED");
          lastPhoneLogRef.current = now;
        }

        if (hasMultiplePersons && now - lastMultiplePersonsLogRef.current > HARD_VIOLATION_DEBOUNCE_MS) {
          handleViolation("MULTIPLE_PERSONS");
          lastMultiplePersonsLogRef.current = now;
        }

        if (hasSpeech && now - lastSpeechLogRef.current > HARD_VIOLATION_DEBOUNCE_MS) {
          handleViolation("SPEECH_DETECTED");
          lastSpeechLogRef.current = now;
        }

        if (isNoFace && now - lastNoFaceLogRef.current > HARD_VIOLATION_DEBOUNCE_MS) {
          handleViolation("NO_FACE_DETECTED");
          lastNoFaceLogRef.current = now;
        }

        if (hasGazeStrike && now - lastGazeStrikeLogRef.current > GAZE_STRIKE_DEBOUNCE_MS) {
          handleViolation("GAZE_STRIKE");
          lastGazeStrikeLogRef.current = now;
        }

      } else {
        // Status is Clean — clear UI popup
        setMlAlert(null);
      }
    };

    wsRef.current.onerror = (err) => console.error("❌ ML WS Error:", err);
    wsRef.current.onclose = () => console.log("🔌 ML WS Connection Closed");

    const intervalId = setInterval(() => {
      sendFrameToML();
    }, 1000);

    return () => {
      clearInterval(intervalId);
      if (wsRef.current) wsRef.current.close();
    };
  };

  const sendFrameToML = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!videoRef.current || videoRef.current.videoWidth === 0) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) wsRef.current.send(blob);
    }, "image/jpeg", 0.7);
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
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      try {
        await videoRef.current.play();
      } catch (err) {
        if (err.name !== "AbortError") throw err;
      }
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
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();

    if (settings.displaySurface !== "monitor") {
      stream.getTracks().forEach(t => t.stop());
      throw new Error("You must share the entire screen.");
    }

    screenStreamRef.current = stream;

    track.onended = () => {
      if (proctoringActiveRef.current) {
        handleViolation("SCREEN_SHARE_STOPPED");
      }
    };
  };

  const stopScreenShare = () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
  };

  /* =========================
     FULLSCREEN + MEDIA START
  ========================= */
  const startProctoredExam = async () => {
    try {
      stopCamera();
      stopScreenShare();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      await startCamera();
      await startScreenShare();
      await fullscreenRef.current.requestFullscreen();
      setIsFullscreen(true);

      setTimeout(() => {
        proctoringActiveRef.current = true;
        console.log("✅ Proctoring is now active");
      }, 2000);

      startMLMonitoring();
    } catch (err) {
      alert(err.message || "Permission denied");
      stopCamera();
      stopScreenShare();
    }
  };

  /* =========================
     FULLSCREEN EXIT DETECTION
  ========================= */
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        if (exam && !isSubmittedRef.current && proctoringActiveRef.current) {
          proctoringActiveRef.current = false;
          handleViolation("EXIT_FULLSCREEN");
        }
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [exam]);

  /* =========================
     TAB / WINDOW DETECTION
  ========================= */
  useEffect(() => {
    if (!exam || isSubmitted) return;

    const handleHidden = () => {
      if (!proctoringActiveRef.current) return;
      if (document.visibilityState !== "visible") {
        handleViolation("TAB_SWITCH");
      }
    };

    const handleBlur = () => {
      if (!proctoringActiveRef.current) return;
      blurTimeoutRef.current = setTimeout(() => {
        handleViolation("WINDOW_BLUR");
      }, 1000);
    };

    const handleFocus = () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", handleHidden);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleHidden);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, [exam, isSubmitted]);

  /* =========================
     START EXAM (API ONLY)
  ========================= */
  useEffect(() => {
    const startExam = async () => {
      const token = localStorage.getItem("authToken");
      if (!token || !examCode) {
        setError("Invalid exam entry.");
        setLoading(false);
        return;
      }

      if (startCalledRef.current) return;
      startCalledRef.current = true;

      try {
        const { data } = await axios.post(
          `${API_BASE_URL}/start`,
          { examCode },
          { headers: { Authorization: `Bearer ${token}` } }
        );

        setExam(data.exam);
        setTimeLeft(data.exam.duration * 60);

        const init = {};
        data.exam.questions.forEach(q => (init[q._id] = ""));
        setAnswers(init);
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
      if (wsRef.current) wsRef.current.close();
    };
  }, [examCode]);

  /* =========================
     TIMER
  ========================= */
  useEffect(() => {
    if (!exam || isSubmitted || timeLeft <= 0) return;

    const t = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(t);
          handleSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(t);
  }, [exam, timeLeft, isSubmitted]);

  /* =========================
     VIOLATIONS
  ========================= */
  const handleViolation = async type => {
    if (!exam || isSubmittedRef.current) return;
    if (!proctoringActiveRef.current && type !== "EXIT_FULLSCREEN") return;

    try {
      const token = localStorage.getItem("authToken");

      const res = await axios.post(
        PROCTOR_API,
        { examId: exam._id, type },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.data.strikes >= MAX_STRIKES) {
        alert("Maximum violations reached. Exam submitted.");
        handleSubmit(true);
      } else {
        const silentTypes = [
          "SUSPICIOUS_GAZE", "FACE_NOT_VISIBLE", "WINDOW_BLUR", 
          "GAZE_STRIKE", "PHONE_DETECTED", "MULTIPLE_PERSONS", 
          "NO_FACE_DETECTED", "SPEECH_DETECTED"
        ];
        
        const isSilent = silentTypes.some(s => type.includes(s));

        if (!isSilent) {
          alert(`⚠️ System Violation: ${type}`);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  /* =========================
     SUBMIT
  ========================= */
  const handleSubmit = async timeout => {
    if (isSubmittedRef.current) return;

    isSubmittedRef.current = true;
    setIsSubmitted(true);

    const token = localStorage.getItem("authToken");

    await axios.post(
      "http://localhost:5000/api/submissions",
      {
        examId: exam._id,
        answers: Object.entries(answers).map(([q, a]) => ({
          questionId: q,
          answer: a.trim(),
        })),
        timeout,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    stopCamera();
    stopScreenShare();
    if (wsRef.current) wsRef.current.close();
    sessionStorage.removeItem("examCode");

    alert("Exam submitted successfully.");
    navigate("/dashboard");
  };

  /* =========================
     UI RENDER
  ========================= */
  const formatTime = useMemo(() => {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [timeLeft]);

  if (loading)
    return (
      <div className="h-screen flex items-center justify-center">
        Loading…
      </div>
    );

  if (error)
    return (
      <div className="p-8 max-w-lg mx-auto mt-20 bg-red-100 rounded">
        <XMarkIcon className="w-6 h-6 inline mr-2" />
        {error}
      </div>
    );

  const q = exam.questions[currentQuestionIndex];

  // Dynamic styling based on alert type
  const alertConfig = {
    info: { bg: "bg-blue-500", border: "border-blue-500", shadow: "shadow-[0_0_20px_rgba(59,130,246,0.8)]", title: "SYSTEM SETUP", icon: <InformationCircleIcon className="w-8 h-8" /> },
    warning: { bg: "bg-orange-500", border: "border-orange-500", shadow: "shadow-[0_0_20px_rgba(249,115,22,0.8)]", title: "WARNING", icon: <ExclamationTriangleIcon className="w-8 h-8" /> },
    violation: { bg: "bg-red-600", border: "border-red-500", shadow: "shadow-[0_0_20px_rgba(239,68,68,0.8)]", title: "PROCTORING ALERT", icon: <ExclamationTriangleIcon className="w-8 h-8" /> }
  };

  const currentConfig = alertConfig[mlAlertType] || alertConfig.warning;

  return (
    <div ref={fullscreenRef} className="min-h-screen bg-gray-50 relative">

      {/* --- ML ALERT OVERLAY --- */}
      {mlAlert && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-pulse">
          <div className={`text-white px-6 py-4 rounded shadow-2xl flex items-center gap-3 border-4 border-white ${currentConfig.bg}`}>
            {currentConfig.icon}
            <div>
              <h3 className="font-bold text-lg">{currentConfig.title}</h3>
              <p>{mlAlert}</p>
            </div>
          </div>
        </div>
      )}

      {/* Re-entry overlay */}
      {!isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-900 text-white gap-4">
          <ExclamationTriangleIcon className="w-12 h-12 text-yellow-400" />
          <p className="text-lg font-semibold text-yellow-300">
            FULL SCREEN REQUIRED
          </p>
          <button
            onClick={startProctoredExam}
            className="px-8 py-4 bg-indigo-600 rounded text-xl font-bold hover:bg-indigo-700 transition"
          >
            Return to Exam
          </button>
        </div>
      )}

      {/* Webcam preview with dynamic glowing borders */}
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
          <div className="font-mono text-lg">
            <ClockIcon className="w-6 h-6 inline" /> {formatTime}
          </div>
        </div>

        <div className="bg-white p-6 rounded shadow">
          <h2 className="text-xl font-semibold mb-4">
            Question {currentQuestionIndex + 1}/{exam.questions.length}
          </h2>

          <p className="mb-4">{q.questionText}</p>

          {q.type === "mcq" &&
            q.options.map((opt, i) => (
              <label key={i} className="block mb-2">
                <input
                  type="radio"
                  checked={answers[q._id] === opt}
                  onChange={() =>
                    setAnswers(p => ({ ...p, [q._id]: opt }))
                  }
                  className="mr-2"
                />
                {opt}
              </label>
            ))}

          {q.type === "text" && (
            <textarea
              rows="5"
              value={answers[q._id]}
              onChange={e =>
                setAnswers(p => ({ ...p, [q._id]: e.target.value }))
              }
              className="w-full border p-2 rounded"
            />
          )}

          <div className="flex justify-between mt-6">
            <button
              disabled={currentQuestionIndex === 0}
              onClick={() => setCurrentQuestionIndex(i => i - 1)}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition"
            >
              <ChevronLeftIcon className="w-5 h-5 inline" /> Prev
            </button>

            <button
              disabled={currentQuestionIndex === exam.questions.length - 1}
              onClick={() => setCurrentQuestionIndex(i => i + 1)}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
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