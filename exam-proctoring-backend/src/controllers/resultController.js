import Submission from "../models/Submission.js";
import Exam from "../models/Exam.js";
import BehaviorAnalysis from "../models/BehaviorAnalysis.js";

/* =========================
   ORGANIZER: EXAM RESULTS
========================= */
export const getExamResults = async (req, res) => {
  try {
    const { examId } = req.params;
    const organizerId = req.user._id;

    /* =========================
       VERIFY EXAM + OWNERSHIP
    ========================= */
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    if (exam.createdBy.toString() !== organizerId.toString()) {
      return res.status(403).json({ message: "Not authorized." });
    }

    /* =========================
       FETCH SUBMITTED ATTEMPTS
    ========================= */
    const submissions = await Submission.find({
      examId,
      submittedAt: { $ne: null },
    })
      .populate("candidateId", "name email")
      .sort({ score: -1, submittedAt: 1 });

    /* =========================
       FETCH BEHAVIOR ANALYSIS
    ========================= */
    const analyses = await BehaviorAnalysis.find({ examId });
    const analysisMap = new Map();
    analyses.forEach(a => {
      analysisMap.set(a.candidateId.toString(), {
        isSuspicious: a.isSuspicious,
        confidence: a.confidence,
        riskLevel: a.riskLevel,
        summary: a.summary,
      });
    });

    /* =========================
       BUILD LEADERBOARD
    ========================= */
    const leaderboard = submissions.map((submission, index) => {
      const candidateIdStr = submission.candidateId?._id?.toString();
      const behavior = analysisMap.get(candidateIdStr) || null;

      return {
        rank: index + 1,
        candidate: submission.candidateId
          ? {
              _id: submission.candidateId._id,
              name: submission.candidateId.name,
              email: submission.candidateId.email,
            }
          : {
              name: "Deleted User",
              email: "N/A",
            },
        score: submission.score,
        submittedAt: submission.submittedAt,
        behaviorAnalysis: behavior,
      };
    });

    /* =========================
       RESPONSE
    ========================= */
    res.json({
      exam: {
        _id: exam._id,
        title: exam.title,
        description: exam.description,
        startTime: exam.startTime,
        endTime: exam.endTime,
        duration: exam.duration,
        examCode: exam.examCode,
      },
      totalParticipants: leaderboard.length,
      leaderboard,
    });
  } catch (error) {
    console.error("❌ Error fetching exam results:", error);
    res.status(500).json({
      message: "Server error while fetching results.",
    });
  }
};
