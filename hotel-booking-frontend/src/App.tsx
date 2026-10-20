import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
} from "react-router-dom";

import Layout from "./layouts/Layout";
import AuthLayout from "./layouts/AuthLayout";
import ScrollToTop from "./components/ScrollToTop";
import { Toaster } from "./components/ui/toaster";

import Register from "./pages/Register";
import SignIn from "./pages/SignIn";
import AddHotel from "./pages/AddHotel";
import OccupancyCalendar from "./pages/OccupancyCalendar";
import ManageBookings from "./pages/ManageBookings";
import Notifications from "./pages/Notifications";
import EditHotel from "./pages/EditHotel";
import MyHotels from "./pages/MyHotels";
import Settings from "./pages/Settings";
import Detail from "./pages/Detail";
import Booking from "./pages/Booking";
import MyBookings from "./pages/MyBookings";
import ManageBooking from "./pages/ManageBooking";
import Home from "./pages/Home";
import ApiDocs from "./pages/ApiDocs";
import ApiStatus from "./pages/ApiStatus";
import AdminDashboard from "./pages/AdminDashboard";
import Unauthorized from "./pages/Unauthorized";

import ProtectedRoute from "./components/ProtectedRoute";

const App = () => {
  return (
    <Router>
      <ScrollToTop />

      <Routes>
        {/* PUBLIC ROUTES */}
        <Route path="/" element={<Layout><Home /></Layout>} />
        <Route path="/search" element={<Navigate to="/" replace />} />
        <Route path="/detail/:hotelId" element={<Layout><Detail /></Layout>} />
        {/* Guest checkout: booking does not require an account. */}
        <Route
          path="/hotel/:hotelId/booking"
          element={
            <Layout>
              <Booking />
            </Layout>
          }
        />
        <Route
          path="/manage-booking"
          element={
            <Layout>
              <ManageBooking />
            </Layout>
          }
        />
        <Route path="/api-docs" element={<Layout><ApiDocs /></Layout>} />
        <Route path="/api-status" element={<Layout><ApiStatus /></Layout>} />

        {/* AUTH ROUTES */}
        <Route
          path="/register"
          element={
            <AuthLayout>
              <Register />
            </AuthLayout>
          }
        />
        <Route
          path="/sign-in"
          element={
            <AuthLayout>
              <SignIn />
            </AuthLayout>
          }
        />

        {/* LOGGED-IN USERS */}
        <Route
          path="/my-bookings"
          element={
            <ProtectedRoute>
              <Layout>
                <MyBookings />
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* HOTEL OWNER */}
        <Route
          path="/add-hotel"
          element={
            <ProtectedRoute roles={["hotel_owner"]}>
              <Layout>
                <AddHotel />
              </Layout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/edit-hotel/:hotelId"
          element={
            <ProtectedRoute roles={["hotel_owner"]}>
              <Layout>
                <EditHotel />
              </Layout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/my-hotels"
          element={
            <ProtectedRoute roles={["hotel_owner"]}>
              <Layout>
                <MyHotels />
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* PHASE 3: booking management (owner + admin) */}
        <Route
          path="/my-hotels/:hotelId/bookings"
          element={
            <ProtectedRoute roles={["hotel_owner", "admin"]}>
              <Layout>
                <ManageBookings />
              </Layout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/my-hotels/:hotelId/calendar"
          element={
            <ProtectedRoute roles={["hotel_owner", "admin"]}>
              <Layout>
                <OccupancyCalendar />
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* PHASE 3: manager settings (owner + admin) */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute roles={["hotel_owner", "admin"]}>
              <Layout>
                <Settings />
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* ADMIN */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={["admin"]}>
              <Layout>
                <AdminDashboard />
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* PHASE 4: notifications outbox (admin) */}
        <Route
          path="/admin/notifications"
          element={
            <ProtectedRoute roles={["admin"]}>
              <Layout>
                <Notifications />
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* SYSTEM */}
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* FALLBACK */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toaster />
    </Router>
  );
};

export default App;
