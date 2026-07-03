import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import api from '../api/client';

const PLACEHOLDER_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect fill="%23E5E7EB" width="100%25" height="100%25"/><text x="50%25" y="54%25" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="%23717A83" font-family="system-ui, sans-serif">?</text></svg>';
const RECORDS_PAGE_SIZE = 10;

const sortBy = (rows, key, asc) => {
  return [...rows].sort((a, b) => {
    const left = String(a[key] || '').toLowerCase();
    const right = String(b[key] || '').toLowerCase();
    if (left === right) return 0;
    return asc ? (left < right ? -1 : 1) : left > right ? -1 : 1;
  });
};

function getVisiblePages(currentPage, totalPages) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage]);
  if (currentPage > 1) pages.add(currentPage - 1);
  if (currentPage < totalPages) pages.add(currentPage + 1);

  return [...pages].sort((a, b) => a - b);
}

export default function EmployeesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('full_name');
  const [sortAsc, setSortAsc] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [recordsPage, setRecordsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function loadEmployees() {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get('/employees');
        if (!mounted) return;
        setEmployees(data.employees || []);
      } catch (err) {
        console.error('Failed to load employees:', err);
        if (!mounted) return;
        setError('Unable to load employee data.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadEmployees();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = employees.filter((employee) => {
      if (!query) return true;
      return [
        employee.full_name,
        employee.employee_code,
        employee.role,
        employee.department,
        employee.shift,
        employee.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    return sortBy(matches, sortKey, sortAsc);
  }, [search, sortKey, sortAsc, employees]);

  const recordsTotalPages = Math.max(1, Math.ceil(filteredEmployees.length / RECORDS_PAGE_SIZE));

  useEffect(() => {
    if (recordsPage > recordsTotalPages) {
      setRecordsPage(recordsTotalPages);
    }
  }, [recordsPage, recordsTotalPages]);

  const paginatedEmployees = useMemo(() => {
    const start = (recordsPage - 1) * RECORDS_PAGE_SIZE;
    return filteredEmployees.slice(start, start + RECORDS_PAGE_SIZE);
  }, [filteredEmployees, recordsPage]);

  const visiblePages = getVisiblePages(recordsPage, recordsTotalPages);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc((current) => !current);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Workforce management</p>
          <h1>Employees</h1>
          <p className="muted">Search, sort, and browse employee details from one place.</p>
        </div>
      </header>

      <section className="card">
        <div className="section-header employees-header">
          <div>
            <h2>Employee list</h2>
            <p className="muted">Use the search field to filter names, codes, roles, or departments.</p>
          </div>

          <div className="employees-actions">
            <input
              type="search"
              placeholder="Search employees..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="search-input"
              aria-label="Search employees"
            />
            <button type="button" className="primary-button" onClick={() => navigate('/employees/add')}>
              <UserPlus size={16} style={{display: 'inline', marginRight: 4}}/>Add Employee
            </button>
          </div>
        </div>

        

        <div className="employees-table-wrap">
          <table className="app-table">
            {error ? <p className="error-message">{error}</p> : null}
            {loading ? <p className="muted" style={{padding: 10, marginTop: 10}}>Loading employees...</p> : null}
            <thead>
              <tr>
                <th onClick={() => handleSort('full_name')}>
                  Name<span className="sort-indicator">{sortKey === 'full_name' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th onClick={() => handleSort('employee_code')}>
                  Code<span className="sort-indicator">{sortKey === 'employee_code' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th onClick={() => handleSort('role')}>
                  Role<span className="sort-indicator">{sortKey === 'role' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('department')}>
                  Department<span className="sort-indicator">{sortKey === 'department' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th className="hide-mobile" onClick={() => handleSort('shift')}>
                  Shift<span className="sort-indicator">{sortKey === 'shift' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
                <th onClick={() => handleSort('status')}>
                  Status<span className="sort-indicator">{sortKey === 'status' ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedEmployees.map((employee) => (
                <tr
                  key={employee.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/employees/${employee.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      navigate(`/employees/${employee.id}`);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <img
                      src={employee.img_url || PLACEHOLDER_AVATAR}
                      alt={employee.img_url ? `${employee.full_name} photo` : 'No photo available'}
                      style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '9999px', border: '1px solid #d1d5db', backgroundColor: '#e5e7eb' }}
                    />
                    <div>
                        <strong>{employee.full_name}</strong>
                        <div className="table-subtext">{employee.role}</div>
                      </div>
                    </div>
                  </td>
                  <td>{employee.employee_code}</td>
                  <td>{employee.job_description}</td>
                  <td className="hide-mobile">{employee.department}</td>
                  <td className="hide-mobile">{employee.shift}</td>
                  <td>
                    <span className="employee-status-chip">{employee.status}</span>
                  </td>
                </tr>
              ))}
              {!loading && filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="6" className="muted">
                    No matching employees found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {!loading && !error && filteredEmployees.length > 0 ? (
          <div className="attendance-pagination" style={{ marginTop: '16px' }}>
            <span className="attendance-page-summary">
              Showing {(recordsPage - 1) * RECORDS_PAGE_SIZE + 1} to {Math.min(recordsPage * RECORDS_PAGE_SIZE, filteredEmployees.length)} of {filteredEmployees.length} employees
            </span>
            {recordsTotalPages > 1 ? (
              <div className="attendance-page-controls">
                <button
                  type="button"
                  className="attendance-page-nav"
                  disabled={recordsPage === 1}
                  onClick={() => setRecordsPage((p) => p - 1)}
                >
                  Previous
                </button>
                {visiblePages.map((pageNumber, index) => {
                  const previousPage = visiblePages[index - 1];
                  const needsEllipsis = index > 0 && pageNumber - previousPage > 1;

                  return (
                    <span key={pageNumber} className="attendance-page-number-wrap">
                      {needsEllipsis ? <span className="attendance-page-ellipsis">...</span> : null}
                      <button
                        type="button"
                        className={`attendance-page-number${recordsPage === pageNumber ? ' active' : ''}`}
                        onClick={() => setRecordsPage(pageNumber)}
                      >
                        {pageNumber}
                      </button>
                    </span>
                  );
                })}
                <button
                  type="button"
                  className="attendance-page-nav"
                  disabled={recordsPage === recordsTotalPages}
                  onClick={() => setRecordsPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
