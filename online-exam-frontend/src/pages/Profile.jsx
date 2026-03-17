import React, { useEffect, useState } from "react";
import axios from "axios";

const API_BASE_URL = "http://localhost:5000/api";

const Profile = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* =========================
     FETCH PROFILE
  ========================= */
  useEffect(() => {
    const fetchProfile = async () => {
      const token = localStorage.getItem("authToken");
      if (!token) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      try {
        const { data } = await axios.get(
          `${API_BASE_URL}/auth/profile`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        setUser(data);
      } catch (err) {
        console.error("Profile fetch error:", err);
        setError("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  /* =========================
     UI STATES
  ========================= */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-600">Loading profile…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  /* =========================
     RENDER
  ========================= */
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-lg p-8">
          {/* Header */}
          <div className="border-b border-gray-200 pb-4 mb-6">
            <h1 className="text-2xl font-semibold text-gray-900">
              Profile Information
            </h1>
          </div>

          {/* Profile Details */}
          <div className="space-y-6">
            <div className="flex border-b border-gray-100 pb-4">
              <div className="w-32 text-sm font-medium text-gray-500">
                Name
              </div>
              <div className="flex-1 text-gray-900">
                {user.name}
              </div>
            </div>

            <div className="flex border-b border-gray-100 pb-4">
              <div className="w-32 text-sm font-medium text-gray-500">
                Email
              </div>
              <div className="flex-1 text-gray-900">
                {user.email}
              </div>
            </div>

            <div className="flex border-b border-gray-100 pb-4">
              <div className="w-32 text-sm font-medium text-gray-500">
                Role
              </div>
              <div className="flex-1">
                <span className="inline-block px-3 py-1 text-sm font-medium text-gray-700 bg-gray-100 rounded capitalize">
                  {user.role}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;