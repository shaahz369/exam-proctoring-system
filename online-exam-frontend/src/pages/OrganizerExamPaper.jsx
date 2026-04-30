import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";

const API_BASE_URL = "http://localhost:5000/api/organizer";

const OrganizerExamPaper = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* =========================
     FETCH EXAM (QUESTION PAPER)
  ========================= */
  useEffect(() => {
    const fetchExam = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        navigate("/login");
        return;
      }

      try {
        const { data } = await axios.get(
          `${API_BASE_URL}/exams/${examId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        setExam(data);
      } catch (err) {
        console.error("Fetch exam paper error:", err);
        setError(
          err.response?.data?.message || "Failed to load exam paper."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchExam();
  }, [examId, navigate]);

  /* =========================
     UI STATES
  ========================= */
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-blue-600 text-lg">
        Loading question paper…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-10 text-center text-red-600">
        <p className="mb-4">{error}</p>
        <button
          onClick={() => navigate(-1)}
          className="text-blue-600 underline"
        >
          Go Back
        </button>
      </div>
    );
  }

  /* =========================
     RENDER
  ========================= */
  return (
    <div className="h-screen overflow-y-auto bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center bg-white p-6 rounded shadow">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {exam.title}
            </h1>
            <p className="text-gray-600">
              Question Paper Preview
            </p>
          </div>

          <button
            onClick={() => navigate(-1)}
            className="flex items-center text-blue-600 hover:text-blue-800"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-1" />
            Back
          </button>
        </div>

        {/* Questions */}
        <div className="space-y-6">
          {Array.isArray(exam.questions) && exam.questions.length > 0 ? (
            exam.questions.map((q, index) => (
              <div
                key={q._id}
                className="bg-white p-6 rounded shadow"
              >
                <h2 className="font-semibold text-lg mb-3">
                  Q{index + 1}. {q.questionText}
                </h2>

                {/* MCQ */}
                {q.type === "mcq" && Array.isArray(q.options) && (
                  <ul className="space-y-2 ml-4">
                    {q.options.map((opt, i) => (
                      <li
                        key={i}
                        className={`flex items-center gap-2 ${
                          q.correctAnswer === String(i)
                            ? "text-green-600 font-semibold"
                            : "text-gray-700"
                        }`}
                      >
                        {q.correctAnswer === String(i) && (
                          <CheckCircleIcon className="w-4 h-4" />
                        )}
                        {String.fromCharCode(65 + i)}. {opt}
                      </li>
                    ))}
                  </ul>
                )}

                {/* TEXT */}
                {q.type === "text" && (
                  <p className="italic text-gray-600 mt-2">
                    Correct Answer:{" "}
                    <span className="font-medium">
                      {q.correctAnswer || "—"}
                    </span>
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-center text-gray-500">
              No questions found for this exam.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrganizerExamPaper;
