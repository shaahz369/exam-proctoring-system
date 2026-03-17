import express from "express";
import {
  submitExam,
  getMySubmissions,
  getMySubmissionDetail,
  getSubmissionsByExam,
} from "../controllers/submissionController.js";
import { authMiddleware as protect } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================
   CANDIDATE ROUTES
========================= */

// Submit exam
router.post("/", protect, submitExam);

// Get all my submissions
router.get("/my", protect, getMySubmissions);

// Get full detail of a single submission (questions + answers + scoring)
router.get("/my/:submissionId", protect, getMySubmissionDetail);

/* =========================
   ORGANIZER ROUTES
========================= */

// Get all submissions for a specific exam
router.get("/exam/:examId", protect, getSubmissionsByExam);

export default router;