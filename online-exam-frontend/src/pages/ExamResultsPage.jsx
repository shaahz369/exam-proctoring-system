import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  ArrowLeftIcon,
  TrophyIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

const API_BASE_URL = "http://localhost:5000/api";
const MAX_STRIKES = 3;

const ExamResultsPage = () => {
  const { examId } = useParams();
  const navigate = useNavigate();

  const [exam, setExam] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* 🔹 PROCTOR LOG STATE */
  const [proctorLogs, setProctorLogs] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [showLogModal, setShowLogModal] = useState(false);

  /* =========================
     FETCH RESULTS
  ========================= */
  useEffect(() => {
    const fetchResults = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        navigate("/login");
        return;
      }

      try {
        const { data } = await axios.get(
          `${API_BASE_URL}/organizer/exams/${examId}/results`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        setExam(data.exam);
        setLeaderboard(data.leaderboard);
      } catch (err) {
        console.error("Results fetch error:", err);
        setError(
          err.response?.data?.message || "Failed to load exam results."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [examId, navigate]);

  /* =========================
     FETCH PROCTOR LOGS
  ========================= */
  const fetchProctorLogs = async (candidate) => {
    try {
      const token = localStorage.getItem("authToken");

      const { data } = await axios.get(
        `${API_BASE_URL}/proctor/exam/${examId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const candidateLog = data.find(
        (log) => log.userId._id === candidate._id
      );

      setProctorLogs(candidateLog?.events || []);
      setSelectedCandidate(candidate);
      setShowLogModal(true);
    } catch (err) {
      console.error("Failed to fetch proctor logs", err);
      alert("Failed to load proctor logs");
    }
  };

  /* =========================
     UI STATES
  ========================= */
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-blue-600 text-lg">
        Loading Exam Results…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-lg mx-auto mt-20 bg-red-100 rounded">
        {error}
        <button
          onClick={() => navigate("/dashboard")}
          className="block mt-4 bg-red-600 text-white px-4 py-2 rounded"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  /* =========================
     RENDER
  ========================= */
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center bg-white p-6 rounded shadow">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {exam.title} — Results
            </h1>
            <p className="text-gray-600">
              Total Participants: {leaderboard.length}
            </p>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center text-blue-600 hover:text-blue-800"
          >
            <ArrowLeftIcon className="w-5 h-5 mr-1" />
            Back
          </button>
        </div>

        {/* Leaderboard */}
        <div className="bg-white p-6 rounded shadow overflow-x-auto">
          {leaderboard.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium">Rank</th>
                  <th className="px-6 py-3 text-left text-xs font-medium">Candidate</th>
                  <th className="px-6 py-3 text-left text-xs font-medium">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium">Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium">Submitted</th>
                  <th className="px-6 py-3 text-left text-xs font-medium">Proctoring</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leaderboard.map((row) => (
                  <tr key={row.rank}>
                    <td className="px-6 py-4 font-semibold">
                      {row.rank === 1 ? (
                        <span className="flex items-center text-yellow-500">
                          <TrophyIcon className="w-5 h-5 mr-1" /> 1
                        </span>
                      ) : row.rank}
                    </td>
                    <td className="px-6 py-4 flex items-center gap-2">
                      <UserIcon className="w-4 h-4 text-gray-400" />
                      {row.candidate.name}
                    </td>
                    <td className="px-6 py-4">{row.candidate.email}</td>
                    <td className="px-6 py-4 font-bold">{row.score}</td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(row.submittedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => fetchProctorLogs(row.candidate)}
                        className="text-indigo-600 hover:underline"
                      >
                        View Log
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-500 text-center py-6">
              No submissions yet.
            </p>
          )}
        </div>
      </div>

      {/* =========================
          PROCTOR LOG MODAL
      ========================= */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-lg rounded shadow p-6 relative">
            <button
              onClick={() => setShowLogModal(false)}
              className="absolute top-3 right-3"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>

            <h2 className="text-xl font-bold mb-2">
              Proctor Log — {selectedCandidate.name}
            </h2>

            <p className="mb-3">
              Strikes:{" "}
              <span
                className={`font-bold ${
                  proctorLogs.length >= MAX_STRIKES
                    ? "text-red-600"
                    : "text-green-600"
                }`}
              >
                {proctorLogs.length}
              </span>
            </p>

            <p className="mb-4">
              Eligibility:{" "}
              <span
                className={`font-bold ${
                  proctorLogs.length >= MAX_STRIKES
                    ? "text-red-600"
                    : "text-green-600"
                }`}
              >
                {proctorLogs.length >= MAX_STRIKES
                  ? "Not Eligible"
                  : "Eligible"}
              </span>
            </p>

            <ul className="space-y-2 max-h-60 overflow-y-auto">
              {proctorLogs.length > 0 ? (
                proctorLogs.map((e, i) => (
                  <li key={i} className="border p-2 rounded text-sm">
                    <b>{e.type}</b>
                    <div className="text-gray-500">
                      {new Date(e.timestamp).toLocaleString()}
                    </div>
                  </li>
                ))
              ) : (
                <p className="text-gray-500">No violations recorded.</p>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamResultsPage;