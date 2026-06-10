import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './authContext';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/home';

  const [employeeCode, setEmployeeCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (user) {
    return <Navigate to="/home" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(employeeCode.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      const message = err?.response?.data?.error || 'Login failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell login-page">
      <section className="card form-card login-card">
        <p className="eyebrow">DasCNC Workforce Console</p>
        <h2>Sign In</h2>
        <p className="muted" style={{ marginBottom: '16px' }}>Use your employee code and password.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="employeeCode">
            Employee Code
            <input
              id="employeeCode"
              className="login-input"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label htmlFor="password">
            Password
            <div className="login-password-row">
              <input
                id="password"
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="login-toggle-password"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        {error ? <p className="error-message">{error}</p> : null}
      </section>
    </main>
  );
}
