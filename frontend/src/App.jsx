import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import PublicLayout from './layouts/PublicLayout'
import AppLayout from './layouts/AppLayout'
import ProtectedRoute, { afterLogin } from './components/ProtectedRoute'
import Placeholder from './components/Placeholder'
import { useAuth } from './context/AuthContext'

import Home from './pages/Home'
import Privacy from './pages/Privacy'
import Login from './pages/auth/Login'
import AdminLogin from './pages/auth/AdminLogin'
import Signup from './pages/auth/Signup'
import ForgotPassword from './pages/auth/ForgotPassword'
import NotFound from './pages/NotFound'
const Availability = lazy(() => import('./pages/tutor/Availability'))
const ParentDashboard = lazy(() => import('./pages/parent/Dashboard'))
const FindTutor = lazy(() => import('./pages/parent/FindTutor'))
const MatchingWizard = lazy(() => import('./pages/parent/MatchingWizard'))
const MatchResults = lazy(() => import('./pages/parent/MatchResults'))
const TutorProfile = lazy(() => import('./pages/parent/TutorProfile'))
const BookLesson = lazy(() => import('./pages/parent/BookLesson'))
const MyBookings = lazy(() => import('./pages/parent/MyBookings'))
const MyChildren = lazy(() => import('./pages/parent/MyChildren'))
const Payments = lazy(() => import('./pages/parent/Payments'))
const PaymentReturn = lazy(() => import('./pages/parent/PaymentReturn'))
const Receipt = lazy(() => import('./pages/parent/Receipt'))
const Complaints = lazy(() => import('./pages/parent/Complaints'))
const Profile = lazy(() => import('./pages/parent/Profile'))
const SavedTutors = lazy(() => import('./pages/parent/SavedTutors'))
const ChildProgress = lazy(() => import('./pages/parent/ChildProgress'))
const ProgressReport = lazy(() => import('./pages/parent/ProgressReport'))
import ProfileSetup from './pages/tutor/ProfileSetup'
import VerificationStatus from './pages/tutor/VerificationStatus'
import ProfilePreview from './pages/tutor/ProfilePreview'
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminComplaints = lazy(() => import('./pages/admin/AdminComplaints'))

// Redirect logged-in users away from login/signup
function GuestOnly({ children }) {
  const { user, loading } = useAuth()
  const { state } = useLocation()
  if (loading) return null
  return user ? <Navigate to={afterLogin(user, state?.from)} replace /> : children
}

export default function App() {
  return (
    <Suspense fallback={<div role="status" className="p-6 text-center text-slate-600">Loading page…</div>}>
    <Routes>
      <Route path="/admin/login" element={<GuestOnly><AdminLogin /></GuestOnly>} />
      {/* Public */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/privacy" element={<Privacy />} />
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
          <Route path="payments/return" element={<PaymentReturn />} />
          <Route path="payments/:id/receipt" element={<Receipt />} />
          <Route path="complaints" element={<Complaints />} />
          <Route path="profile" element={<Profile />} />
          <Route path="favourites" element={<SavedTutors />} />
          <Route path="children/:id/progress" element={<ChildProgress />} />
          <Route path="children/:id/report" element={<ProgressReport />} />
        </Route>
      </Route>

      {/* Tutor Portal: Yan Hsi */}
      <Route element={<ProtectedRoute roles={['TUTOR']} />}>
        <Route path="/tutor" element={<AppLayout />}>
          {/* Every page is open to every tutor; verification only adds the badge and search priority */}
          <Route index element={<Placeholder title="Tutor Dashboard" />} />
          <Route path="availability" element={<Availability />} />
          <Route path="bookings" element={<Placeholder title="Booking Requests" />} />
          <Route path="students" element={<Placeholder title="My Students" />} />
          <Route path="earnings" element={<Placeholder title="Earnings & Withdrawals" />} />
          <Route path="setup" element={<ProfileSetup />} />
          <Route path="verification" element={<VerificationStatus />} />
          <Route path="preview" element={<ProfilePreview />} />
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
    </Suspense>
  )
}
