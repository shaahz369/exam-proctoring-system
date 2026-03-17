import mongoose from "mongoose";

// src/models/Submission.js
const submissionSchema = new mongoose.Schema(
  {
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

    answers: [
      {
        questionId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Question",
          required: true,
        },
        answer: {
          type: String,
          required:false,
        },
      },
    ],

    score: {
      type: Number,
      default: 0,
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },

    submittedAt: {
      type: Date,
    },

    // ✅ EXPLICIT STATE FLAG (IMPORTANT)
    isSubmitted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

// ✅ PREVENT DUPLICATE ATTEMPTS (CRITICAL)
submissionSchema.index(
  { examId: 1, candidateId: 1 },
  { unique: true }
);

export default mongoose.model("Submission", submissionSchema);
