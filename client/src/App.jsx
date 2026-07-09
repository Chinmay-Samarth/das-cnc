import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/authContext';
import { SocketProvider } from './socket/socketContext';
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
import ComponentsPage from './pages/ComponentsPage';
import ComponentDetailPage from './pages/ComponentDetailPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceDetails from './components/Invoices/InvoiceDetails';
import CustomersPage from './customers/CustomersPage';
import CustomerDetailsPage from './customers/CustomerDetailsPage';
import AddCustomerPage from './customers/AddCustomerPage';
import MasterPage from './masters/MasterPage';
import MasterBuilderPage from './masters/MasterBuilderPage';
import MasterRecordDetailPage from './masters/MasterRecordDetailPage';
import MasterRecordEditPage from './masters/MasterRecordEditPage';
import GIRNListPage from './girn/GIRNListPage';
import CreateGIRNPage from './girn/CreateGIRNPage';
import GIRNDetailPage from './girn/GIRNDetailPage';
import StockListPage from './inventory/StockListPage';
import StockDetailPage from './inventory/StockDetailPage';
import NotFoundPage from './pages/NotFoundPage';

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
      <SocketProvider>
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
            <Route path="/masters/:slug/records/:id/edit" element={<MasterRecordEditPage />} />
            <Route path="/masters/:slug/records/:id" element={<MasterRecordDetailPage />} />
            <Route path="/masters/:slug" element={<MasterPage/>}/>
            <Route path="/masters/config/new" element={<MasterBuilderPage/>}/>
            <Route path='/masters/config/:id' element={<MasterBuilderPage/>}/>
            <Route path="/girn" element={<GIRNListPage />} />
            <Route path="/girn/create" element={<CreateGIRNPage />} />
            <Route path="/girn/:id" element={<GIRNDetailPage />} />
            <Route path="/stock" element={<StockListPage />} />
            <Route path="/stock/:id" element={<StockDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/home" replace />} />
      </Routes>
      </SocketProvider>
    </AuthProvider>
  );
}
