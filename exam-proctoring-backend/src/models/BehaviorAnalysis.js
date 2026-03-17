import mongoose from "mongoose";

const behaviorAnalysisSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
    required: true,
  },
  candidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  isSuspicious: {
    type: Boolean,
    required: true,
  },
  confidence: {
    type: Number,     // 0.0 - 1.0
    required: true,
  },
  riskLevel: {
    type: String,     // "low" | "medium" | "high"
    enum: ["low", "medium", "high"],
    required: true,
  },
  summary: {
    type: String,
    default: "",
  },
  analyzedAt: {
    type: Date,
    default: Date.now,
  },
});

// One analysis per candidate per exam
behaviorAnalysisSchema.index({ examId: 1, candidateId: 1 }, { unique: true });

export default mongoose.model("BehaviorAnalysis", behaviorAnalysisSchema);
