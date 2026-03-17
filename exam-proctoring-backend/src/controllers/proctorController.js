import ProctorLog from "../models/ProctorLog.js";
import BehaviorAnalysis from "../models/BehaviorAnalysis.js";

const STRIKE_TYPES = new Set([
  "EXIT_FULLSCREEN",
  "TAB_SWITCH",
  "WINDOW_BLUR",
  "SCREEN_SHARE_STOPPED",
  "PHONE_DETECTED",
  "MULTIPLE_PERSONS",
  "NO_FACE_DETECTED",   // Candidate left the camera view
]);

export const logViolation = async (req, res) => {
  try {
    const { examId, type } = req.body;
    const userId = req.user._id;

    if (!examId || !type) {
      return res.status(400).json({
        message: "examId and violation type are required",
      });
    }

    let log = await ProctorLog.findOne({ examId, userId });

    if (!log) {
      log = new ProctorLog({
        examId,
        userId,
        events: [],
      });
    }

    log.events.push({
      type,
      timestamp: new Date(),
    });

    await log.save();

    const strikes = log.events.filter(e => STRIKE_TYPES.has(e.type)).length;

    return res.json({
      message: "Violation logged",
      strikes,
      lastEvent: type,
      isStrike: STRIKE_TYPES.has(type),
    });
  } catch (error) {
    console.error("Proctor log error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* =========================
   ORGANIZER: GET LOGS BY EXAM
========================= */
export const getProctorLogsByExam = async (req, res) => {
  try {
    const { examId } = req.params;

    const logs = await ProctorLog.find({ examId })
      .populate("userId", "name email")
      .sort({ createdAt: 1 });

    res.json(logs);
  } catch (error) {
    console.error("Fetch proctor logs error:", error);
    res.status(500).json({
      message: "Failed to fetch proctor logs",
    });
  }
};

/* =========================
   CANDIDATE: SAVE BEHAVIOR ANALYSIS
========================= */
export const saveBehaviorAnalysis = async (req, res) => {
  try {
    const { examId, isSuspicious, confidence, riskLevel, summary } = req.body;
    const candidateId = req.user._id;

    if (!examId || confidence === undefined || !riskLevel) {
      return res.status(400).json({
        message: "examId, confidence, and riskLevel are required",
      });
    }

    const result = await BehaviorAnalysis.findOneAndUpdate(
      { examId, candidateId },
      {
        isSuspicious,
        confidence,
        riskLevel,
        summary: summary || "",
        analyzedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    return res.json({
      message: "Behavior analysis saved",
      result,
    });
  } catch (error) {
    console.error("Save behavior analysis error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* =========================
   ORGANIZER: GET BEHAVIOR ANALYSIS BY EXAM
========================= */
export const getBehaviorAnalysisByExam = async (req, res) => {
  try {
    const { examId } = req.params;

    const analyses = await BehaviorAnalysis.find({ examId })
      .populate("candidateId", "name email")
      .sort({ analyzedAt: 1 });

    res.json(analyses);
  } catch (error) {
    console.error("Fetch behavior analysis error:", error);
    res.status(500).json({
      message: "Failed to fetch behavior analysis",
    });
  }
};