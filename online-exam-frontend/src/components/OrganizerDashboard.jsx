// src/components/OrganizerDashboard.jsx
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  PlusCircleIcon,
  DocumentCheckIcon,
  UserGroupIcon,
  ArrowPathIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = 'http://localhost:5000/api';

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className={`p-5 rounded-xl shadow-md flex items-center space-x-4 ${color}`}>
    <Icon className="w-8 h-8 text-white" />
    <div>
      <p className="text-sm font-medium text-white opacity-80">{title}</p>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  </div>
);

const OrganizerDashboard = ({
  user,
  dashboardData = {},
  onCreateExamClick,
  onRefresh,
}) => {
  const navigate = useNavigate();

  const {
    totalExams = 0,
    totalCandidates = 0,
    totalSubmissions = 0,
    averageScore = 0,
    recentExams = [],
  } = dashboardData;

  /* =========================
     ADD CANDIDATES STATE
  ========================= */
  const [showModal, setShowModal] = useState(false);
  const [selectedExam, setSelectedExam] = useState(null);
  const [emails, setEmails] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  /* =========================
     ADD CANDIDATES HANDLER
  ========================= */
  const handleAddCandidates = async () => {
    if (!emails.trim()) {
      setMessage('Please enter at least one email');
      return;
    }

    try {
      setLoading(true);
      setMessage(null);

      const token = localStorage.getItem('authToken');

      const candidateEmails = emails
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);

      await axios.post(
        `${API_BASE_URL}/exams/${selectedExam._id}/candidates`,
        { candidateEmails },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setMessage('Candidates added successfully');
      setEmails('');
      onRefresh();

      setTimeout(() => {
        setShowModal(false);
        setMessage(null);
      }, 1200);
    } catch (err) {
      setMessage(
        err.response?.data?.message || 'Failed to add candidates'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold text-gray-800">
        Organizer Portal, {user.name.split(' ')[0]}
      </h1>

      {/* Create Exam CTA */}
      <div className="flex justify-between items-center p-6 bg-white border rounded-xl shadow-lg">
        <h2 className="text-xl font-semibold text-gray-700">
          Ready to schedule a new assessment?
        </h2>
        <button
          onClick={onCreateExamClick}
          className="flex items-center px-6 py-3 bg-blue-600 text-white text-lg font-bold rounded-lg hover:bg-blue-700"
        >
          <PlusCircleIcon className="w-6 h-6 mr-2" />
          Create New Exam
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Total Exams" value={totalExams} icon={DocumentCheckIcon} color="bg-indigo-600" />
        <StatCard title="Total Submissions" value={totalSubmissions} icon={DocumentCheckIcon} color="bg-green-600" />
        <StatCard title="Total Candidates" value={totalCandidates} icon={UserGroupIcon} color="bg-yellow-600" />
        <StatCard title="Average Score" value={`${averageScore * 100}%`} icon={UserGroupIcon} color="bg-red-500" />
      </div>

      {/* All Exams — scrollable */}
      <div>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-2xl font-semibold text-gray-800">
            All Exams
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({recentExams.length} total)
            </span>
          </h2>
          <button
            onClick={onRefresh}
            className="flex items-center text-blue-600 hover:text-blue-800 text-sm"
          >
            <ArrowPathIcon className="w-4 h-4 mr-1" />
            Refresh
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {recentExams.length > 0 ? (
            <>
              {/* ✅ Sticky header + scrollable body */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 text-sm font-semibold">#</th>
                      <th className="px-4 py-3 text-sm font-semibold">Title</th>
                      <th className="px-4 py-3 text-sm font-semibold">Code</th>
                      <th className="px-4 py-3 text-sm font-semibold">Start</th>
                      <th className="px-4 py-3 text-sm font-semibold">Status</th>
                      <th className="px-4 py-3 text-sm font-semibold">Actions</th>
                    </tr>
                  </thead>
                </table>
              </div>

              {/* ✅ Scrollable tbody — max 6 rows visible, then scroll */}
              <div className="overflow-y-auto max-h-96 overflow-x-auto">
                <table className="min-w-full">
                  <tbody className="divide-y divide-gray-100">
                    {recentExams.map((exam, index) => (
                      <tr
                        key={exam._id}
                        className="hover:bg-gray-50 transition"
                      >
                        <td className="px-4 py-3 text-sm text-gray-400">
                          {index + 1}
                        </td>
                        <td className="px-4 py-3 font-medium text-blue-600">
                          {exam.title}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">
                          {exam.examCode}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {exam.startTime
                            ? new Date(exam.startTime).toLocaleString()
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            exam.endTime && new Date(exam.endTime) < new Date()
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {exam.endTime && new Date(exam.endTime) < new Date()
                              ? 'Completed'
                              : 'Active'}
                          </span>
                        </td>
                        <td className="px-4 py-3 space-x-3">
                          <button
                            onClick={() => navigate(`/organizer/exams/${exam._id}`)}
                            className="text-indigo-600 hover:underline text-sm"
                          >
                            View Paper
                          </button>
                          <button
                            onClick={() => navigate(`/organizer/exams/${exam._id}/results`)}
                            className="text-blue-600 hover:underline text-sm font-semibold"
                          >
                            View Results
                          </button>
                          <button
                            onClick={() => {
                              setSelectedExam(exam);
                              setShowModal(true);
                            }}
                            className="text-green-600 hover:underline text-sm font-semibold"
                          >
                            Add Candidates
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-center p-6">
              No exams created yet.
            </p>
          )}
        </div>
      </div>

      {/* =========================
         ADD CANDIDATES MODAL
      ========================= */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-xl shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">
                Add Candidates – {selectedExam.title}
              </h2>
              <button onClick={() => setShowModal(false)}>
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <textarea
              rows={4}
              placeholder="Enter emails separated by commas"
              value={emails}
              onChange={e => setEmails(e.target.value)}
              className="w-full border rounded p-2"
            />

            {message && (
              <p className="mt-2 text-sm text-center text-blue-600">
                {message}
              </p>
            )}

            <button
              onClick={handleAddCandidates}
              disabled={loading}
              className="mt-4 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              {loading ? 'Adding…' : 'Add Candidates'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizerDashboard;