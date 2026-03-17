// src/pages/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

import CandidateDashboard from '../components/CandidateDashboard';
import OrganizerDashboard from '../components/OrganizerDashboard';
import CreateExamForm from '../components/CreateExamForm';
import Profile from './Profile';

import {
  UserCircleIcon,
  DocumentTextIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ArrowLeftOnRectangleIcon,
  PlusCircleIcon,
} from '@heroicons/react/24/outline';

const API_BASE_URL = 'http://localhost:5000/api';

const Dashboard = () => {
  const [user, setUser] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('Dashboard');

  const authToken = localStorage.getItem('authToken');

  /* =========================
     FETCH DATA
  ========================= */
  const fetchData = async () => {
    if (!authToken) return;

    setLoading(true);
    setError(null);

    try {
      /* 🔹 PROFILE */
      const profileRes = await axios.get(
        `${API_BASE_URL}/auth/profile`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      const userData = profileRes.data;
      setUser(userData);

      /* =========================
         ORGANIZER
      ========================= */
      if (userData.role === 'organizer') {
        const dashboardRes = await axios.get(
          `${API_BASE_URL}/organizer/dashboard`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        setDashboardData(dashboardRes.data);
        return;
      }

      /* =========================
         CANDIDATE
      ========================= */
      const [upcomingRes, submissionsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/exams/upcoming`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
        axios.get(`${API_BASE_URL}/submissions/my`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }),
      ]);

      const submissions = submissionsRes.data || [];

      /* ✅ Submitted exam IDs */
      const submittedExamIds = new Set(
        submissions
          .filter(sub => sub.isSubmitted)
          .map(sub => sub.examId?._id)
      );

      /* ✅ REMOVE submitted exams from upcoming */
      const filteredUpcomingExams = (upcomingRes.data || []).filter(
        exam => !submittedExamIds.has(exam._id)
      );

      /* ✅ Past results ONLY from submitted */
      const pastSubmissions = submissions
        .filter(sub => sub.isSubmitted)
        .map(sub => ({
          _id: sub._id,
          title: sub.examId?.title || 'Exam',
          startTime: sub.examId?.startTime,
          submittedAt: sub.submittedAt,
          score: sub.score,
        }));

      setDashboardData({
        upcomingExams: filteredUpcomingExams,
        pastSubmissions,
      });
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError('Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [authToken]);

  /* =========================
     UI HANDLERS
  ========================= */
  const handleTabClick = tab => {
    setActiveTab(tab);
    setError(null);

    if (tab === 'Dashboard' || tab === 'Upcoming Exams') {
      fetchData();
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    window.location.href = '/login';
  };

  if (!authToken) {
    return (
      <div className="h-screen flex items-center justify-center text-red-600">
        Please log in to view the dashboard.
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="h-screen flex items-center justify-center text-lg text-blue-600">
        Loading Dashboard...
      </div>
    );
  }

  /* =========================
     NAV ITEMS
  ========================= */
  const navItems =
    user.role === 'candidate'
      ? [
          { name: 'Dashboard', icon: ChartBarIcon },
          { name: 'Upcoming Exams', icon: CalendarDaysIcon },
          { name: 'Past Results', icon: DocumentTextIcon },
          { name: 'Profile', icon: UserCircleIcon },
        ]
      : [
          { name: 'Dashboard', icon: ChartBarIcon },
          { name: 'Create Exam', icon: PlusCircleIcon },
          { name: 'Profile', icon: UserCircleIcon },
        ];

  /* =========================
     RENDER CONTENT
  ========================= */
  const renderContent = () => {
    if (user.role === 'candidate') {
      switch (activeTab) {
        case 'Dashboard':
          return (
            <CandidateDashboard
              user={user}
              dashboardData={dashboardData}
              view="dashboard"
            />
          );
        case 'Upcoming Exams':
          return (
            <CandidateDashboard
              user={user}
              dashboardData={dashboardData}
              view="upcoming"
            />
          );
        case 'Past Results':
          return (
            <CandidateDashboard
              user={user}
              dashboardData={dashboardData}
              view="past"
            />
          );
        case 'Profile':
          return <Profile />;
        default:
          return null;
      }
    }

    /* ORGANIZER */
    switch (activeTab) {
      case 'Dashboard':
        return (
          <OrganizerDashboard
            user={user}
            dashboardData={dashboardData}
            onRefresh={fetchData}
            onCreateExamClick={() => handleTabClick('Create Exam')}
          />
        );
      case 'Create Exam':
        return (
          <CreateExamForm onSuccess={() => handleTabClick('Dashboard')} />
        );
      case 'Profile':
        return <Profile />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between p-4 shadow-lg">
        <div>
          <div className="flex items-center space-x-2 pb-6 border-b">
            <span className="text-2xl font-bold text-blue-600">
              Exanor
            </span>
          </div>

          <nav className="mt-6 space-y-2">
            {navItems.map(item => (
              <button
                key={item.name}
                onClick={() => handleTabClick(item.name)}
                className={`w-full flex items-center space-x-3 p-3 rounded-xl transition ${
                  activeTab === item.name
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <item.icon className="w-6 h-6" />
                <span>{item.name}</span>
              </button>
            ))}
          </nav>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center pb-8 space-x-3 p-3 rounded-xl text-gray-600 hover:bg-red-50 hover:text-red-600"
        >
          <ArrowLeftOnRectangleIcon className="w-6 h-6" />
          <span>Log Out</span>
        </button>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {renderContent()}
      </main>
    </div>
  );
};

export default Dashboard;