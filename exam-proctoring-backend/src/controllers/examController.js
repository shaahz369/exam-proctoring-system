import Exam from "../models/Exam.js";
import Question from "../models/Question.js";
import Submission from "../models/Submission.js";
import User from "../models/User.js";
import crypto from "crypto";

/* =========================
   CREATE EXAM (ORGANIZER)
   ✅ supports optional candidate emails
========================= */
export const createExam = async (req, res) => {
  try {
    const {
      title,
      description,
      startTime,
      endTime,
      duration,
      questions,
      candidateEmails = [],
    } = req.body;

    if (!title || !questions || questions.length === 0) {
      return res.status(400).json({
        message: "Title and at least one question are required.",
      });
    }

    const examCode = crypto.randomBytes(3).toString("hex").toUpperCase();

    /* =========================
       RESOLVE CANDIDATE EMAILS
    ========================= */
    let assignedCandidates = [];

    if (candidateEmails.length > 0) {
      const users = await User.find({
        email: { $in: candidateEmails },
      });
      assignedCandidates = users.map(u => u._id);
    }

    const exam = await Exam.create({
      title,
      description,
      createdBy: req.user._id,
      startTime,
      endTime,
      duration,
      examCode,
      assignedCandidates,
    });

    const questionDocs = await Promise.all(
      questions.map(q =>
        Question.create({ ...q, examId: exam._id })
      )
    );

    exam.questions = questionDocs.map(q => q._id);
    await exam.save();

    res.status(201).json({
      examId: exam._id,
      examCode,
      message: "Exam created successfully",
    });
  } catch (error) {
    console.error("Create exam error:", error);
    res.status(500).json({
      message: "Server error while creating exam.",
    });
  }
};

/* =========================
   ADD CANDIDATES LATER
   (ORGANIZER)
========================= */
export const addCandidatesToExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { candidateEmails } = req.body;

    if (!candidateEmails || candidateEmails.length === 0) {
      return res.status(400).json({
        message: "Candidate emails are required.",
      });
    }

    const exam = await Exam.findById(examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    if (exam.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const users = await User.find({
      email: { $in: candidateEmails },
    });

    const newCandidateIds = users.map(u => u._id);

    exam.assignedCandidates = [
      ...new Set([...exam.assignedCandidates, ...newCandidateIds]),
    ];

    await exam.save();

    res.json({
      message: "Candidates added successfully.",
      totalAssigned: exam.assignedCandidates.length,
    });
  } catch (error) {
    console.error("Add candidates error:", error);
    res.status(500).json({
      message: "Server error while adding candidates.",
    });
  }
};

/* =========================
   GET ORGANIZER EXAMS
========================= */
export const getMyExams = async (req, res) => {
  try {
    const exams = await Exam.find({
      createdBy: req.user._id,
    }).populate("questions");

    res.json(exams);
  } catch (error) {
    console.error("Get my exams error:", error);
    res.status(500).json({
      message: "Server error while fetching exams.",
    });
  }
};

/* =========================
   CANDIDATE: UPCOMING EXAMS
   ✅ FOR DASHBOARD
========================= */
export const getCandidateUpcomingExams = async (req, res) => {
  try {
    const candidateId = req.user._id;

   const exams = await Exam.find({
  assignedCandidates: candidateId,
  endTime: { $gt: new Date() },
}).select("title startTime endTime examCode");

    res.json(exams);
  } catch (error) {
    console.error("Upcoming exams error:", error);
    res.status(500).json({
      message: "Failed to load upcoming exams.",
    });
  }
};

/* =========================
   JOIN EXAM (CANDIDATE)
   ✅ BY CODE OR ASSIGNMENT
========================= */
export const joinExam = async (req, res) => {
  try {
    const { examCode } = req.body;
    const candidateId = req.user._id;

    if (!examCode) {
      return res.status(400).json({
        message: "Exam code is required.",
      });
    }

    const exam = await Exam.findOne({ examCode });

    if (!exam) {
      return res.status(404).json({
        message: "Invalid exam code.",
      });
    }

    // 🔒 Enforce assignment if candidates exist
    if (
      exam.assignedCandidates.length > 0 &&
      !exam.assignedCandidates.some(
        id => id.toString() === candidateId.toString()
      )
    ) {
      return res.status(403).json({
        message: "You are not assigned to this exam.",
      });
    }

    // ❌ Exam window closed
    if (exam.endTime && Date.now() > new Date(exam.endTime).getTime()) {
      return res.status(403).json({
        message: "Exam window has closed.",
      });
    }

    let submission = await Submission.findOne({
      examId: exam._id,
      candidateId,
    });

    if (!submission) {
      submission = await Submission.create({
        examId: exam._id,
        candidateId,
      });
    }

    res.json({
      examId: exam._id,
      title: exam.title,
      startTime: exam.startTime,
      endTime: exam.endTime,
      message: "Exam joined successfully.",
    });
  } catch (error) {
    console.error("Join exam error:", error);
    res.status(500).json({
      message: "Server error while joining exam.",
    });
  }
};

/* =========================
   START / RESUME EXAM
   ❗ ONLY ATTEMPT ENTRY
========================= */
export const startExam = async (req, res) => {
  try {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    const { examCode } = req.body;
    const candidateId = req.user._id;

    const exam = await Exam.findOne({ examCode }).populate(
      "questions",
      "-correctAnswer"
    );

    if (!exam) {
      return res.status(404).json({
        message: "Invalid exam code.",
      });
    }

    const now = Date.now();

    if (exam.startTime && now < new Date(exam.startTime).getTime()) {
      return res.status(403).json({
        message: "Exam has not started yet.",
      });
    }

    if (exam.endTime && now > new Date(exam.endTime).getTime()) {
      return res.status(403).json({
        message: "Exam window has closed.",
      });
    }

    let submission = await Submission.findOne({
      examId: exam._id,
      candidateId,
    });

    if (submission?.submittedAt) {
      return res.status(403).json({
        message: "You have already submitted this exam.",
      });
    }

    if (!submission) {
      submission = await Submission.create({
        examId: exam._id,
        candidateId,
        startedAt: new Date(),
      });
    }

    res.json({
      exam,
      submissionId: submission._id,
      message: "Exam started successfully.",
    });
  } catch (error) {
    console.error("Start exam error:", error);
    res.status(500).json({
      message: "Server error during exam start.",
    });
  }
};

/* =========================
   ORGANIZER: GET EXAM
========================= */
export const getExamById = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).populate("questions");

    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    if (exam.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden." });
    }

    res.json(exam);
  } catch (error) {
    console.error("Get exam by ID error:", error);
    res.status(500).json({ message: "Server error." });
  }
};
