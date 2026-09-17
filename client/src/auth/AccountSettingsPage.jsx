import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { useAuth } from '../auth/authContext';
import { AlertBanner, PageHeader } from '../components/mes';
import { appAlert } from '../components/dialog';

const MIN_LEN = 8;

/**
 * Shared change-password form used by Account Settings and first-login gate.
 */
export function ChangePasswordForm({
  requireCurrent = true,
  submitLabel = 'Update password',
  onSuccess,
}) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword.length < MIN_LEN) {
      setError(`New password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (requireCurrent && !currentPassword) {
      setError('Current password is required.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({
        currentPassword: requireCurrent ? currentPassword : undefined,
        newPassword,
        confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (onSuccess) {
        await onSuccess();
      } else {
        await appAlert({
          title: 'Password updated',
          message: 'Your password has been changed successfully.',
          tone: 'success',
        });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to change password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="account-password-form" onSubmit={handleSubmit}>
      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

      {requireCurrent ? (
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={submitting}
            required
          />
        </label>
      ) : (
        <AlertBanner tone="info">
          Choose a new password to continue. You will use this password for future sign-ins.
        </AlertBanner>
      )}

      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={submitting}
          minLength={MIN_LEN}
          required
        />
      </label>

      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={submitting}
          minLength={MIN_LEN}
          required
        />
      </label>

      <div className="account-password-actions">
        <button type="submit" className="primary-button" disabled={submitting}>
          <Check size={16} />
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export default function AccountSettingsPage() {
  const navigate = useNavigate();
  const { user, defaultHomePath } = useAuth();
  const mustChange = Boolean(user?.must_change_password);

  return (
    <main className="mes-shell account-settings-shell">
      <PageHeader
        eyebrow="Account"
        title="Account Settings"
        subtitle="Manage your sign-in password"
        actions={null}
      />
      <div className="account-settings-center">
        <section className="mes-card form-card account-settings-card">
          <h2 className="account-settings-heading">Change password</h2>
          <p className="muted account-settings-hint">
            Use at least {MIN_LEN} characters. Do not share your password with anyone.
          </p>
          <ChangePasswordForm
            requireCurrent={!mustChange}
            submitLabel="Update password"
          />
        </section>
      </div>
    </main>
  );
}
