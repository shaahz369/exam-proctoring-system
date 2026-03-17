import Submission from "../models/Submission.js";
import Exam from "../models/Exam.js";

/* =========================
   SUBMIT EXAM (CANDIDATE)
========================= */
export const submitExam = async (req, res) => {
  try {
    const { examId, answers } = req.body;
    const candidateId = req.user._id;
    const now = new Date();

    if (!examId || !Array.isArray(answers)) {
      return res.status(400).json({ message: "Invalid submission payload." });
    }

    const exam = await Exam.findById(examId).populate("questions");
    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    if (exam.startTime && now < new Date(exam.startTime)) {
      return res.status(403).json({ message: "Exam has not started yet." });
    }
    if (exam.endTime && now > new Date(exam.endTime)) {
      return res.status(403).json({ message: "Exam has ended." });
    }

    const submission = await Submission.findOne({ examId, candidateId });
    if (!submission) {
      return res.status(403).json({ message: "Exam not started. Please start the exam first." });
    }

    if (submission.submittedAt || submission.isSubmitted) {
      return res.status(403).json({ message: "Exam already submitted." });
    }

    /* =========================
       AUTO-SCORING (MCQ)
    ========================= */
    let score = 0;
    const questionMap = new Map();
    exam.questions.forEach(q => {
      questionMap.set(q._id.toString(), q);
    });

    answers.forEach(ans => {
      const question = questionMap.get(ans.questionId);
      if (!question) return;
      if (question.type === "mcq") {
        const correctIndex = question.correctAnswer;
        const correctOption = question.options[Number(correctIndex)];
        if (correctOption !== undefined && ans.answer.trim() === correctOption.trim()) {
          score += 1;
        }
      }
    });

    submission.answers = answers;
    submission.score = score;
    submission.submittedAt = now;
    submission.isSubmitted = true;

    await submission.save();

    res.status(201).json({ message: "Exam submitted successfully.", score });
  } catch (error) {
    console.error("Submit exam error:", error);
    res.status(500).json({ message: "Server error during submission." });
  }
};

/* =========================
   CANDIDATE: MY SUBMISSIONS
========================= */
export const getMySubmissions = async (req, res) => {
  try {
    const submissions = await Submission.find({
      candidateId: req.user._id,
    }).populate("examId", "title startTime endTime");

    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: "Server error." });
  }
};

/* =========================
   CANDIDATE: SUBMISSION DETAIL
   GET /api/submissions/my/:submissionId
   Returns questions + candidate answers + correct answers for review
========================= */
export const getMySubmissionDetail = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const candidateId = req.user._id;

    // Find submission and verify it belongs to this candidate
    const submission = await Submission.findOne({
      _id: submissionId,
      candidateId,
    });

    if (!submission) {
      return res.status(404).json({ message: "Submission not found." });
    }

    if (!submission.isSubmitted) {
      return res.status(403).json({ message: "Exam not yet submitted." });
    }

    // Fetch exam with all questions INCLUDING correctAnswer (candidate's own review)
    const exam = await Exam.findById(submission.examId).populate("questions");
    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    // Build answer map from submission: questionId → candidate's answer
    const answerMap = new Map();
    submission.answers.forEach(a => {
      answerMap.set(a.questionId.toString(), a.answer || "");
    });

    // Build detailed question review
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    const questions = exam.questions.map((q, index) => {
      const candidateAnswer = answerMap.get(q._id.toString()) || "";
      const correctIndex = q.correctAnswer;
      const correctOption = q.type === "mcq" ? q.options[Number(correctIndex)] : null;

      let status = "skipped"; // default

      if (q.type === "mcq") {
        if (!candidateAnswer) {
          status = "skipped";
          skippedCount++;
        } else if (candidateAnswer.trim() === correctOption?.trim()) {
          status = "correct";
          correctCount++;
        } else {
          status = "wrong";
          wrongCount++;
        }
      } else {
        // Text question — just mark as answered or skipped
        if (candidateAnswer.trim()) {
          status = "answered";
        } else {
          status = "skipped";
          skippedCount++;
        }
      }

      return {
        index: index + 1,
        questionId: q._id,
        questionText: q.questionText,
        type: q.type,
        options: q.options || [],
        correctAnswer: correctOption,       // correct option text for MCQ
        candidateAnswer,                    // what candidate wrote/selected
        status,                             // correct | wrong | skipped | answered
      };
    });

    res.json({
      submission: {
        _id: submission._id,
        score: submission.score,
        submittedAt: submission.submittedAt,
        totalQuestions: exam.questions.length,
        correctCount,
        wrongCount,
        skippedCount,
      },
      exam: {
        _id: exam._id,
        title: exam.title,
        duration: exam.duration,
        startTime: exam.startTime,
      },
      questions,
    });
  } catch (error) {
    console.error("Submission detail error:", error);
    res.status(500).json({ message: "Server error." });
  }
};

/* =========================
   ORGANIZER: EXAM SUBMISSIONS
========================= */
export const getSubmissionsByExam = async (req, res) => {
  try {
    const { examId } = req.params;

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: "Exam not found." });
    }

    if (exam.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const submissions = await Submission.find({ examId })
      .populate("candidateId", "name email")
      .populate("answers.questionId", "questionText type options");

    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: "Server error." });
  }
};