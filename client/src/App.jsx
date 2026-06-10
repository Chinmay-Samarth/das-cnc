import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/authContext';
import LoginPage from './auth/LoginPage';
import AttendancePage from './attendance/attendance';
import EmployeesPage from './employees/EmployeesPage';
import AddEmployeePage from './employees/AddEmployeePage';
import EmployeeDetailsPage from './employees/EmployeeDetailsPage';
import HomePage from './home/HomePage';
import { MastersNavProvider } from './context/MastersNavContext';
import AppLayout from './components/Layout/AppLayout';
import MasterBuilderPage from './pages/MasterBuilderPage';
import ComponentsPage from './pages/ComponentsPage';
import ComponentDetailPage from './pages/ComponentDetailPage';
import MasterPage from './pages/MasterPage';
import MasterRecordDetailPage from './pages/MasterRecordDetailPage';

function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return <main className="app-shell">Loading...</main>;
  }

  if (!user) {
    return <Navigate to="/auth/login" replace />;
  }

  return <Outlet />;
}

function PublicOnly() {
  const { user, loading } = useAuth();

  if (loading) {
    return <main className="app-shell">Loading...</main>;
  }

  if (user) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/auth/login" element={<LoginPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route
            element={
              <MastersNavProvider>
                <AppLayout />
              </MastersNavProvider>
            }
          >
            <Route path="/home" element={<HomePage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/add" element={<AddEmployeePage />} />
            <Route path="/employees/:id" element={<EmployeeDetailsPage />} />
            <Route path="/employees/:id/edit" element={<EmployeeDetailsPage />} />
            <Route path="/components" element={<ComponentsPage />} />
            <Route path="/components/:id" element={<ComponentDetailPage />} />
            <Route path="/masters/new" element={<MasterBuilderPage />} />
            <Route path="/masters/:masterId/configure" element={<MasterBuilderPage />} />
            <Route path="/masters/:masterId/records/:recordId" element={<MasterRecordDetailPage />} />
            <Route path="/masters/:masterId" element={<MasterPage />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </AuthProvider>
  );
}