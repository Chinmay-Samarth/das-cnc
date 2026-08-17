import { Link } from 'react-router-dom';
import { ClipboardList, PackageCheck } from 'lucide-react';

export default function ApprovalsShortcutPanel({ approvals }) {
  const shortfall = approvals?.dispatch_shortfall_pending || 0;
  const girn = approvals?.girn_ready || 0;

  return (
    <div className="mes-dash-approvals">
      <Link to="/approvals?tab=dispatch&status=pending" className="mes-dash-approval-tile">
        <PackageCheck size={18} />
        <div>
          <strong>{shortfall}</strong>
          <p>Dispatch shortfall</p>
        </div>
      </Link>
      <Link to="/approvals?tab=girn&status=ready" className="mes-dash-approval-tile">
        <ClipboardList size={18} />
        <div>
          <strong>{girn}</strong>
          <p>GIRN ready</p>
        </div>
      </Link>
    </div>
  );
}
