import { useEffect, useMemo } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/authContext';
import { PageHeader } from '../components/mes';
import DispatchShortfallTab from './DispatchShortfallTab';
import GirnApprovalsTab from './GirnApprovalsTab';

const TABS = [
  { key: 'dispatch', label: 'Dispatch shortfall' },
  { key: 'girn', label: 'GIRN' },
];

export default function ApprovalsPage() {
  const { user, defaultHomePath } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isReviewer =
    user?.accessLevel === 'ADMIN' || user?.accessLevel === 'SUPERVISOR';

  const activeTab = searchParams.get('tab') === 'girn' ? 'girn' : 'dispatch';
  const status = searchParams.get('status') || (activeTab === 'girn' ? 'ready' : 'pending');

  const initialDispatchStatus = activeTab === 'dispatch' ? status : 'pending';
  const initialGirnStatus = activeTab === 'girn' ? status : 'ready';

  useEffect(() => {
    if (!searchParams.get('tab')) {
      setSearchParams({ tab: 'dispatch', status: 'pending' }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const subtitle = useMemo(() => {
    if (activeTab === 'girn') {
      return 'Review GIRNs after item inspections pass. Approve to post stock or reject to block receipt.';
    }
    return 'Approve shipping less than the delivery schedule quantity. Remaining demand stays open.';
  }, [activeTab]);

  if (!isReviewer) {
    return <Navigate to={defaultHomePath()} replace />;
  }

  function selectTab(tabKey) {
    const nextStatus = tabKey === 'girn' ? 'ready' : 'pending';
    setSearchParams({ tab: tabKey, status: nextStatus });
  }

  return (
    <main className="mes-shell">
      <PageHeader eyebrow="Shop floor" title="Approvals" subtitle={subtitle} />

      <div className="mes-view-toggle" role="tablist" aria-label="Approval type" style={{ marginBottom: 20 }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={`mes-view-toggle-btn${activeTab === key ? ' is-active' : ''}`}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'dispatch' ? (
        <DispatchShortfallTab initialStatus={initialDispatchStatus} />
      ) : (
        <GirnApprovalsTab initialStatus={initialGirnStatus} />
      )}
    </main>
  );
}

export function DispatchApprovalsRedirect() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status') || 'pending';
  return <Navigate to={`/approvals?tab=dispatch&status=${encodeURIComponent(status)}`} replace />;
}
