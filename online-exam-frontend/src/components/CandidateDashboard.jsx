// src/components/CandidateDashboard.jsx
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  ClockIcon,
  CheckCircleIcon,
  PlayIcon,
  PencilSquareIcon,
  CalendarIcon,
  AcademicCapIcon,
  XMarkIcon,
  CheckIcon,
  XCircleIcon,
  MinusCircleIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = 'http://localhost:5000/api/exams';
const SUBMISSION_API = 'http://localhost:5000/api/submissions';

/* =========================
   SUBMISSION DETAIL MODAL
========================= */
const SubmissionDetailModal = ({ submissionId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    const fetchDetail = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const res = await axios.get(`${SUBMISSION_API}/my/${submissionId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setData(res.data);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load details.');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [submissionId]);

  const statusIcon = (status) => {
    if (status === 'correct') return <CheckIcon className="w-4 h-4 text-green-600" />;
    if (status === 'wrong') return <XCircleIcon className="w-4 h-4 text-red-500" />;
    return <MinusCircleIcon className="w-4 h-4 text-gray-400" />;
  };

  const statusBg = (status) => {
    if (status === 'correct') return 'bg-green-50 border-green-200';
    if (status === 'wrong') return 'bg-red-50 border-red-200';
    if (status === 'answered') return 'bg-blue-50 border-blue-200';
    return 'bg-gray-50 border-gray-200';
  };

  const optionStyle = (option, q) => {
    const isCorrect = q.type === 'mcq' && option === q.correctAnswer;
    const isCandidate = option === q.candidateAnswer;

    if (isCorrect && isCandidate) return 'bg-green-100 border border-green-400 text-green-800 font-semibold';
    if (isCorrect) return 'bg-green-50 border border-green-300 text-green-700 font-semibold';
    if (isCandidate && !isCorrect) return 'bg-red-100 border border-red-400 text-red-800 line-through';
    return 'bg-white border border-gray-200 text-gray-700';
  };

  return (
    <div className="fixed inset-0 backdrop-blur-md bg-black/20 flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">
            {data ? data.exam.title : 'Exam Review'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center h-40 text-gray-400">
              Loading your results...
            </div>
          )}

          {error && (
            <div className="text-red-500 text-center py-10">{error}</div>
          )}

          {data && (
            <>
              {/* Score Summary */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-5 text-white mb-6">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <p className="text-blue-100 text-sm">Final Score</p>
                    <p className="text-4xl font-extrabold">{data.submission.score}</p>
                    <p className="text-blue-200 text-xs mt-1">
                      out of {data.submission.totalQuestions} questions
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-blue-100 text-xs">Submitted</p>
                    <p className="text-sm font-semibold">
                      {new Date(data.submission.submittedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-white bg-opacity-20 rounded-full h-2 mt-2">
                  <div
                    className="bg-white rounded-full h-2 transition-all"
                    style={{
                      width: `${(data.submission.score / data.submission.totalQuestions) * 100}%`,
                    }}
                  />
                </div>

                {/* Stats row */}
                <div className="flex gap-4 mt-4 text-sm">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-300 inline-block" />
                    <span className="text-blue-100">{data.submission.correctCount} Correct</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-300 inline-block" />
                    <span className="text-blue-100">{data.submission.wrongCount} Wrong</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                    <span className="text-blue-100">{data.submission.skippedCount} Skipped</span>
                  </div>
                </div>
              </div>

              {/* Questions */}
              <div className="space-y-4">
                {data.questions.map((q) => (
                  <div
                    key={q.questionId}
                    className={`rounded-xl border p-4 ${statusBg(q.status)}`}
                  >
                    {/* Question header */}
                    <div className="flex items-start justify-between mb-3">
                      <p className="font-semibold text-gray-800 text-sm leading-snug">
                        <span className="text-gray-400 mr-2">Q{q.index}.</span>
                        {q.questionText}
                      </p>
                      <span className="ml-3 flex-shrink-0">
                        {statusIcon(q.status)}
                      </span>
                    </div>

                    {/* MCQ Options */}
                    {q.type === 'mcq' && (
                      <div className="grid grid-cols-1 gap-2 mt-2">
                        {q.options.map((opt, i) => (
                          <div
                            key={i}
                            className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${optionStyle(opt, q)}`}
                          >
                            <span className="text-xs font-bold text-gray-400 w-5">
                              {String.fromCharCode(65 + i)}.
                            </span>
                            {opt}
                            {opt === q.correctAnswer && (
                              <span className="ml-auto text-xs bg-green-200 text-green-800 px-1.5 py-0.5 rounded font-semibold">
                                Correct
                              </span>
                            )}
                            {opt === q.candidateAnswer && opt !== q.correctAnswer && (
                              <span className="ml-auto text-xs bg-red-200 text-red-700 px-1.5 py-0.5 rounded font-semibold">
                                Your answer
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Text answer */}
                    {q.type === 'text' && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Your Answer</p>
                        <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm text-gray-700 min-h-[60px]">
                          {q.candidateAnswer || (
                            <span className="text-gray-400 italic">No answer provided</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================
   EXAM CARD
========================= */
const ExamCard = ({ exam, type, onDetailsClick }) => {
  const navigate = useNavigate();
  const isUpcoming = type === 'upcoming';

  const formatDate = (date) =>
    new Date(date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });

  const formatTime = (date) =>
    new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });

  const handleStartExam = async () => {
    if (!isUpcoming) return;
    try {
      const token = localStorage.getItem('authToken');
      if (!token) { navigate('/login'); return; }

      await axios.post(
        `${API_BASE_URL}/start`,
        { examCode: exam.examCode },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      navigate('/exam', { state: { examCode: exam.examCode } });
    } catch (err) {
      alert(err.response?.data?.message || 'Unable to start exam at this time.');
    }
  };

  // --- PAST RESULTS CARD ---
  if (!isUpcoming) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-sm transition-shadow">
        <div className="flex justify-between items-start mb-4">
          <div className="p-2 bg-gray-50 rounded-lg">
            <AcademicCapIcon className="w-6 h-6 text-gray-400" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 bg-gray-100 text-gray-600 rounded">
            Completed
          </span>
        </div>

        <h4 className="text-lg font-bold text-gray-900 mb-1 truncate">
          {exam.title || 'Assessment'}
        </h4>
        <p className="text-xs text-gray-500 flex items-center mb-4">
          <CalendarIcon className="w-3 h-3 mr-1" />
          Finished on {formatDate(exam.submittedAt || exam.startTime)}
        </p>

        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 pt-4 mt-2">
          <div>
            <span className="block text-[10px] text-gray-400 uppercase font-bold tracking-tight">Score</span>
            <span className="text-lg font-bold text-blue-600">
              {exam.score !== undefined ? `${Math.round(exam.score)}` : '—'}
            </span>
          </div>
          <div className="text-right">
            {/* ✅ Details button now opens the review modal */}
            <button
              className="mt-2 text-xs font-semibold text-gray-600 hover:text-blue-600 flex items-center justify-end ml-auto"
              onClick={() => onDetailsClick(exam._id)}
            >
              <PencilSquareIcon className="w-4 h-4 mr-1" />
              Details
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- UPCOMING EXAM CARD ---
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-blue-400 transition-all group">
      <div className="h-1.5 bg-blue-600 w-full" />
      <div className="p-5">
        <div className="flex justify-between items-center mb-3">
          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
            {exam.examCode}
          </span>
          <div className="flex items-center text-gray-400 text-xs">
            <ClockIcon className="w-3 h-3 mr-1" />
            {formatTime(exam.startTime)}
          </div>
        </div>

        <h4 className="text-lg font-bold text-gray-800 mb-4 group-hover:text-blue-700 transition-colors truncate">
          {exam.title || 'Exam'}
        </h4>

        <div className="flex items-center text-sm text-gray-600 mb-5">
          <CalendarIcon className="w-4 h-4 mr-2 text-gray-400" />
          <span>{formatDate(exam.startTime)}</span>
        </div>

        <button
          onClick={handleStartExam}
          className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2 shadow-sm"
        >
          <PlayIcon className="w-4 h-4" />
          <span>Start Exam</span>
        </button>
      </div>
    </div>
  );
};

/* =========================
   CANDIDATE DASHBOARD
========================= */
const CandidateDashboard = ({ user, dashboardData, view }) => {
  const { upcomingExams = [], pastSubmissions = [] } = dashboardData || {};

  // Modal state — stores the submissionId to review
  const [detailSubmissionId, setDetailSubmissionId] = useState(null);

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
          Welcome back, {user?.name?.split(' ')[0]}!
        </h1>
        <p className="text-gray-500 mt-1">Here is what is happening with your assessments.</p>
      </header>

      {/* Alert Banner */}
      <div className="bg-white border border-blue-100 p-4 rounded-xl shadow-sm flex items-start">
        <div className="bg-blue-50 p-2 rounded-lg mr-4">
          <CheckCircleIcon className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <p className="font-bold text-gray-900 text-sm">System Ready</p>
          <p className="text-sm text-gray-600">
            All systems are operational. Please ensure a stable internet connection before starting any proctored session.
          </p>
        </div>
      </div>

      {/* Upcoming Section */}
      {(view === 'dashboard' || view === 'upcoming') && (
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">Upcoming Exams</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {upcomingExams.length > 0 ? (
              upcomingExams.map(exam => (
                <ExamCard key={exam._id} exam={exam} type="upcoming" onDetailsClick={() => {}} />
              ))
            ) : (
              <div className="col-span-full py-12 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-500">
                <CalendarIcon className="w-10 h-10 mb-2 text-gray-300" />
                <p>No upcoming exams scheduled.</p>
              </div>
            )}
          </div>
        </section>
      )}

     {/* Past Results Section */}
{(view === 'dashboard' || view === 'past') && (
  <section className="pb-10">
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-xl font-bold text-gray-800">Academic History</h2>
    </div>

    {/* 🔥 Scrollable Card Container */}
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
      
      {/* Scroll area */}
      <div className="max-h-[500px] overflow-y-auto pr-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          
          {pastSubmissions.length > 0 ? (
            pastSubmissions.map(sub => (
              <ExamCard
                key={sub._id}
                exam={sub}
                type="past"
                onDetailsClick={(submissionId) => setDetailSubmissionId(submissionId)}
              />
            ))
          ) : (
            <div className="col-span-full py-12 bg-gray-50 rounded-2xl flex flex-col items-center justify-center text-gray-400">
              <p>No past results found.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  </section>
)}

      {/* ✅ Submission Detail Modal */}
      {detailSubmissionId && (
        <SubmissionDetailModal
          submissionId={detailSubmissionId}
          onClose={() => setDetailSubmissionId(null)}
        />
      )}
    </div>
  );
};

export default CandidateDashboard;