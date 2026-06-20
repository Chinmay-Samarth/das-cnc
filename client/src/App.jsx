import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/authContext';
import LoginPage from './auth/LoginPage';
import AttendancePage from './attendance/attendance';
import EmployeesPage from './employees/EmployeesPage';
import AddEmployeePage from './employees/AddEmployeePage';
import EmployeeDetailsPage from './employees/EmployeeDetailsPage';
import SuppliersPage from './suppliers/SuppliersPage';
import AddSupplierPage from './suppliers/AddSupplierPage';
import SupplierDetailsPage from './suppliers/SupplierDetailsPage';
import HomePage from './home/HomePage';
import { MastersNavProvider } from './context/MastersNavContext';
import AppLayout from './components/Layout/AppLayout';
import MasterBuilderPage from './pages/MasterBuilderPage';
import ComponentsPage from './pages/ComponentsPage';
import ComponentDetailPage from './pages/ComponentDetailPage';
import MasterPage from './pages/MasterPage';
import MasterRecordDetailPage from './pages/MasterRecordDetailPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceDetails from './components/Invoices/InvoiceDetails';
import CustomersPage from './customers/CustomersPage';
import CustomerDetailsPage from './customers/CustomerDetailsPage';
import AddCustomerPage from './customers/AddCustomerPage';

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
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/suppliers/add" element={<AddSupplierPage />} />
            <Route path="/suppliers/:id" element={<SupplierDetailsPage />} />
            <Route path="/suppliers/:id/invoices" element={<SupplierDetailsPage />} />
            <Route path="/suppliers/:id/edit" element={<SupplierDetailsPage />} />
            <Route path="/components" element={<ComponentsPage />} />
            <Route path="/components/:id" element={<ComponentDetailPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path= "/invoices/:id" element={<InvoiceDetails/>}/>
            <Route path="/customers" element={<CustomersPage />}/>
            <Route path="/customers/:id" element={<CustomerDetailsPage/>}/>
            <Route path="/customers/add" element={<AddCustomerPage/>}/>
            <Route path="/customers/:id/edit" element={<CustomerDetailsPage/>}/>
            <Route path="/masters/new" element={<MasterBuilderPage />}/>
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
