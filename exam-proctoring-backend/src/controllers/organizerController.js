import Exam from "../models/Exam.js";
import Submission from "../models/Submission.js";
import ProctorLog from "../models/ProctorLog.js";

/* =========================
   STRIKE TYPES — must match proctorController.js
========================= */
const STRIKE_TYPES = new Set([
  "EXIT_FULLSCREEN",
  "TAB_SWITCH",
  "WINDOW_BLUR",
  "SCREEN_SHARE_STOPPED",
  "PHONE_DETECTED",
  "MULTIPLE_PERSONS",
  "NO_FACE_DETECTED",
]);

/* =========================
   ORGANIZER DASHBOARD
========================= */
export const getOrganizerDashboard = async (req, res) => {
  try {
    const organizerId = req.user._id;

    const exams = await Exam.find({ createdBy: organizerId }).sort({
      createdAt: -1,
    });

    // ✅ Calculate totalSubmissions and totalScore across ALL exams (not just 5)
    let totalSubmissions = 0;
    let totalScore = 0;
    const uniqueCandidateIds = new Set(); // ✅ Track unique candidates

    const allSubmissions = await Submission.find({
      examId: { $in: exams.map(e => e._id) },
      submittedAt: { $ne: null },
    });

    allSubmissions.forEach(s => {
      totalSubmissions++;
      totalScore += s.score || 0;
      if (s.candidateId) {
        uniqueCandidateIds.add(s.candidateId.toString()); // ✅ Unique candidates
      }
    });

    const averageScore =
      totalSubmissions > 0
        ? (totalScore / totalSubmissions).toFixed(2)
        : 0;

    // ✅ recentExams still shows only last 5 for the table
    const recentExams = exams.map(exam => ({
      _id: exam._id,
      title: exam.title,
      examCode: exam.examCode,
      startTime: exam.startTime,
      endTime: exam.endTime,
    }));

    res.json({
      totalExams: exams.length,
      totalCandidates: uniqueCandidateIds.size, // ✅ Unique candidates, not submissions
      totalSubmissions,
      averageScore,
      recentExams,
    });
  } catch (error) {
    console.error("❌ Organizer dashboard error:", error);
    res.status(500).json({
      message: "Server error while loading organizer dashboard",
    });
  }
};

/* =========================
   ORGANIZER EXAMS LIST
========================= */
export const getOrganizerExams = async (req, res) => {
  try {
    const exams = await Exam.find({
      createdBy: req.user._id,
    }).sort({ createdAt: -1 });

    res.json(exams);
  } catch (error) {
    console.error("❌ Failed to fetch organizer exams:", error);
    res.status(500).json({ message: "Failed to fetch exams" });
  }
};

/* =========================
   ORGANIZER VIEW EXAM
========================= */
export const getOrganizerExam = async (req, res) => {
  try {
    const { examId } = req.params;

    const exam = await Exam.findById(examId).populate("questions");

    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    if (exam.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden." });
    }

    res.json(exam);
  } catch (error) {
    console.error("❌ Error fetching organizer exam:", error);
    res.status(500).json({
      message: "Server error while fetching exam.",
    });
  }
};

/* =========================
   ORGANIZER: PROCTOR LOGS
========================= */
export const getExamProctorLogs = async (req, res) => {
  try {
    const { examId } = req.params;

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    // 🔒 Ownership check
    if (exam.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const logs = await ProctorLog.find({ examId })
      .populate("userId", "name email")
      .sort({ "events.timestamp": 1 });

    const formatted = logs.map(log => ({
      candidate: {
        _id: log.userId._id,
        name: log.userId.name,
        email: log.userId.email,
      },
      // ✅ Only count events that are real strikes, not all events
      strikes: log.events.filter(e => STRIKE_TYPES.has(e.type)).length,
      events: log.events,
    }));

    res.json(formatted);
  } catch (error) {
    console.error("❌ Proctor logs error:", error);
    res.status(500).json({ message: "Server error." });
  }
};