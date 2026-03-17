import mongoose from "mongoose";

// Explicit subdocument schema to avoid Mongoose misreading
// { type: String } as a type declaration instead of a field definition
const eventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false } // No need for _id on each event subdocument
);

const proctorLogSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  events: [eventSchema],
});

export default mongoose.model("ProctorLog", proctorLogSchema);