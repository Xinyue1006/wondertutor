import { Navigate, Route, Routes } from 'react-router-dom'
import PublicLayout from './layouts/PublicLayout'
import AppLayout from './layouts/AppLayout'
import ProtectedRoute, { homeFor } from './components/ProtectedRoute'
import Placeholder from './components/Placeholder'
import { useAuth } from './context/AuthContext'

import Home from './pages/Home'
import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import ForgotPassword from './pages/auth/ForgotPassword'
import NotFound from './pages/NotFound'
import ParentDashboard from './pages/parent/Dashboard'
import FindTutor from './pages/parent/FindTutor'
import MatchingWizard from './pages/parent/MatchingWizard'
import MatchResults from './pages/parent/MatchResults'
import TutorProfile from './pages/parent/TutorProfile'
import BookLesson from './pages/parent/BookLesson'
import MyBookings from './pages/parent/MyBookings'
import MyChildren from './pages/parent/MyChildren'
import Payments from './pages/parent/Payments'
import Complaints from './pages/parent/Complaints'
import Profile from './pages/parent/Profile'
import SavedTutors from './pages/parent/SavedTutors'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsers from './pages/admin/AdminUsers'
import AdminComplaints from './pages/admin/AdminComplaints'

// Redirect logged-in users away from login/signup
function GuestOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? <Navigate to={homeFor(user.role)} replace /> : children
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPassword /></GuestOnly>} />
      </Route>

      {/* Parent Portal: Xin Yue */}
      <Route element={<ProtectedRoute roles={['PARENT']} />}>
        <Route path="/parent" element={<AppLayout />}>
          <Route index element={<ParentDashboard />} />
          <Route path="find-tutor" element={<FindTutor />} />
          <Route path="find-tutor/match" element={<MatchingWizard />} />
          <Route path="find-tutor/results" element={<MatchResults />} />
          <Route path="tutors/:id" element={<TutorProfile />} />
          <Route path="tutors/:id/book" element={<BookLesson />} />
          <Route path="bookings" element={<MyBookings />} />
          <Route path="children" element={<MyChildren />} />
          <Route path="payments" element={<Payments />} />
          <Route path="complaints" element={<Complaints />} />
          <Route path="profile" element={<Profile />} />
          <Route path="favourites" element={<SavedTutors />} />
        </Route>
      </Route>

      {/* Tutor Portal: Yan Hsi */}
      <Route element={<ProtectedRoute roles={['TUTOR']} />}>
        <Route path="/tutor" element={<AppLayout />}>
          <Route index element={<Placeholder title="Tutor Dashboard" />} />
          <Route path="availability" element={<Placeholder title="My Availability" />} />
          <Route path="bookings" element={<Placeholder title="Booking Requests" />} />
          <Route path="students" element={<Placeholder title="My Students" />} />
          <Route path="earnings" element={<Placeholder title="Earnings & Withdrawals" />} />
        </Route>
      </Route>

      {/* Admin: shared */}
      <Route element={<ProtectedRoute roles={['ADMIN']} />}>
        <Route path="/admin" element={<AppLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="complaints" element={<AdminComplaints />} />
          <Route path="bookings" element={<Placeholder title="Booking Oversight" note="Yan Hsi" />} />
          <Route path="finance" element={<Placeholder title="Financial Management" note="Yan Hsi" />} />
          <Route path="settings" element={<Placeholder title="System Configuration" note="Yan Hsi" />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
