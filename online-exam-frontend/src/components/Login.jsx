import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from 'react-router-dom'; // 1. IMPORT NAVIGATE

// NOTE: Change this URL to your actual backend server address (e.g., http://localhost:5000)
const API_BASE_URL = "http://localhost:5000/api/auth";


// Renamed component function to Login
export default function Login({ onAuthSuccess }) {
  const [isLoginView, setIsLoginView] = useState(true); 
  
  // Form Fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [role, setRole] = useState("candidate"); 
  
  // UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // 2. INITIALIZE NAVIGATE
  const navigate = useNavigate();


  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const actualEmail = email; 
    const actualPassword = password; 

    const endpoint = isLoginView ? "/login" : "/register";
    const payload = isLoginView 
        ? { email: actualEmail, password: actualPassword }
        : { name, email: actualEmail, password: actualPassword, role };
    
    try {
      const { data } = await axios.post(`${API_BASE_URL}${endpoint}`, payload);
      setLoading(false);
      
      if (!isLoginView) {
        // Successful Registration: Switch to login view and show success message
        setError("Registration successful! Please log in.");
        setName("");
        setEmail(""); 
        setPassword(""); 
        setIsLoginView(true);
      } else {
        // 3. SUCCESSFUL LOGIN LOGIC: STORE TOKEN, NOTIFY PARENT, AND REDIRECT
        
        // Store Token
        if (data.token) {
            localStorage.setItem("authToken", data.token);
        }
        
        // Notify Parent Component (App.jsx)
        if (onAuthSuccess) {
            // Pass back the user data (assuming it's nested under data.user or is the entire data object)
            onAuthSuccess(data.user || data);
        }
        
        // Redirect to Dashboard - THIS IS WHAT NEEDS THE ROUTER CONTEXT
        navigate("/dashboard"); 
      }
    } catch (err) {
      setLoading(false);
      setError(
        err.response?.data?.message || "Login failed. Check credentials and try again."
      );
    }
  };

  // Dynamic Content & Classes
  const CardTitle = isLoginView ? "Exanor Login" : "Exanor Signup";
  const CardSubtitle = isLoginView ? "Welcome back, please enter your details." : "Join Exanor and start your journey.";
  const primaryClasses = "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"; 
  const inputClasses = "w-full bg-gray-100 rounded-lg border border-gray-300 py-3 px-4 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-gray-900 transition duration-150 shadow-sm text-base";
  const buttonBase = "w-full py-2.5 rounded-lg text-white text-lg font-semibold shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition duration-150";


  // --- Render Login View ---
  const LoginView = (
    <div className="space-y-6">
      
      {/* Email Field */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email address</label>
        <div className="mt-1">
          <input
            id="email" name="email" type="email" required autoComplete="email"
            placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
            disabled={loading} className={inputClasses}
          />
        </div>
      </div>

      {/* Password Field */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
        <div className="mt-1">
          <input
            id="password" name="password" type="password" required autoComplete="current-password"
            placeholder="********" value={password} onChange={(e) => setPassword(e.target.value)}
            disabled={loading} className={inputClasses}
          />
        </div>
      </div>

      {/* Remember Me & Forgot Password */}
      <div className="flex justify-between items-center text-sm">
        <label className="flex items-center text-gray-600 select-none">
          <input
            type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            disabled={loading}
            className="mr-2 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Remember me
        </label>
        <a
          href="#"
          className="font-medium text-blue-600 hover:text-blue-700 transition duration-150"
        >
          Forgot your password?
        </a>
      </div>
      
      {/* Submit Button */}
      <button
        type="submit" disabled={loading}
        className={`${buttonBase} ${primaryClasses}`}
      >
        {loading ? "Logging in..." : "Log In"}
      </button>

      {/* Social Login Buttons */}
      <div className="text-center text-gray-500 text-sm py-2">Or continue with</div>

      <div className="flex space-x-4">
        <button className="flex-1 flex justify-center items-center py-2 border border-gray-300 rounded-lg shadow-sm text-gray-700 hover:bg-gray-50 transition duration-150">
          <span className="mr-2 text-xl">G</span> Google
        </button>
        <button className="flex-1 flex justify-center items-center py-2 border border-gray-300 rounded-lg shadow-sm text-gray-700 hover:bg-gray-50 transition duration-150">
          <span className="mr-2 text-xl">f</span> Facebook
        </button>
      </div>

    </div>
  );


  // --- Render Signup View ---
  const SignupView = (
    <div className="space-y-6">
      
      {/* Name Field */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Full Name</label>
        <div className="mt-1">
          <input
            id="name" name="name" type="text" required placeholder="John Doe"
            value={name} onChange={(e) => setName(e.target.value)} disabled={loading}
            className={inputClasses}
          />
        </div>
      </div>

      {/* Email Field */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email address</label>
        <div className="mt-1">
          <input
            id="email" name="email" type="email" required placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading}
            className={inputClasses}
          />
        </div>
      </div>

      {/* Password Field */}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
        <div className="mt-1">
          <input
            id="password" name="password" type="password" required placeholder="Choose a strong password"
            value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading}
            className={inputClasses}
          />
        </div>
      </div>
      
      {/* Role Selection */}
      <div className="flex justify-between items-center text-gray-700">
          <label htmlFor="role" className="font-medium text-sm">Account Type:</label>
          <select
              id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)} disabled={loading}
              className="py-2 px-3 rounded-lg bg-gray-100 border border-gray-300 focus:ring-blue-500 focus:border-blue-500 cursor-pointer text-gray-900 text-sm"
          >
              <option value="candidate">Candidate</option>
              <option value="organizer">Organizer</option>
          </select>
      </div>

      {/* Submit Button */}
      <button
        type="submit" disabled={loading}
        className={`${buttonBase} ${primaryClasses}`}
      >
        {loading ? "Registering..." : "Create Account"}
      </button>

    </div>
  );


  // --- Main Render Block ---
  return (
    <div className="fixed inset-0 bg-gray-100 flex items-center justify-center overflow-hidden p-6">
      {/* Card Container */}
      <div className="bg-white rounded-xl shadow-xl p-8 max-w-sm w-full space-y-6 transition duration-300">
        
        {/* Header */}
        <div className="text-center space-y-2">
          {/* Logo Placeholder */}
          <div className="w-10 h-10 mx-auto rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-blue-600 text-2xl">💡</span> 
          </div>

          <h2 className="text-2xl font-bold text-gray-900">
            {CardTitle}
          </h2>
          <p className="text-sm text-gray-600">
            {CardSubtitle}
          </p>
        </div>

        {/* Error Message */}
        {error && (
            <p className={`text-center font-medium pt-2 text-sm ${error.includes("successful") ? "text-green-600" : "text-red-500"}`}>
              {error}
            </p>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {isLoginView ? LoginView : SignupView}
        </form>

        {/* Switch Link (bottom of the card) */}
        <p className="text-center text-gray-600 text-sm pt-4 border-t border-gray-100">
          {isLoginView ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
                setIsLoginView(!isLoginView);
                setError(""); 
                setName("");
                setEmail("");
                setPassword("");
            }}
            className="font-bold text-blue-600 hover:text-blue-700 focus:outline-none transition duration-150"
          >
            {isLoginView ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
