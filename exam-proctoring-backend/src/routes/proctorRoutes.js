// routes/proctorRoutes.js
import express from "express";
import {
  logViolation,
  getProctorLogsByExam,
  saveBehaviorAnalysis,
  getBehaviorAnalysisByExam,
} from "../controllers/proctorController.js";
import { authMiddleware as protect } from "../middleware/authMiddleware.js";

const router = express.Router();

/* =========================
   CANDIDATE
========================= */
router.post("/log", protect, logViolation);

/* =========================
   ORGANIZER
========================= */
router.get("/exam/:examId", protect, getProctorLogsByExam);

/* =========================
   BEHAVIOR ANALYSIS
========================= */
router.post("/behavior", protect, saveBehaviorAnalysis);
router.get("/behavior/:examId", protect, getBehaviorAnalysisByExam);

export default router;
