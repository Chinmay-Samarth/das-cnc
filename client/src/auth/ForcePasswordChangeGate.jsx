import { ChangePasswordForm } from './AccountSettingsPage';
import { PageHeader } from '../components/mes';
import { appAlert } from '../components/dialog';

/**
 * Full-screen gate when must_change_password is true.
 */
export default function ForcePasswordChangeGate() {
  return (
    <main className="mes-shell force-password-shell">
      <PageHeader
        eyebrow="Security"
        title="Set a new password"
        subtitle="Your administrator set a temporary password. Update it before continuing."
      />
      <section className="mes-card form-card account-settings-card">
        <ChangePasswordForm
          requireCurrent={false}
          submitLabel="Save and continue"
          onSuccess={async () => {
            await appAlert({
              title: 'Password saved',
              message: 'You can now use the app.',
              tone: 'success',
            });
          }}
        />
      </section>
    </main>
  );
}
