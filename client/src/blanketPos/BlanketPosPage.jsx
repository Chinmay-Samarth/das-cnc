import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, ChevronRight } from 'lucide-react';
import api from '../api/client';
import { formatDisplayDate } from '../utils/dateFormat';
import {
  PageHeader,
  StatusBadge,
  ProgressBar,
  EmptyState,
  TruncatedText,
} from '../components/mes';

function formatMoney(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function BlanketPosPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSecondary, setShowSecondary] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get('/blanket-pos')
      .then(({ data }) => {
        if (!mounted) return;
        const list = data.blanket_pos || [];
        setRows(list);
        if (list.length) setSelectedId(list[0].id);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load blanket POs.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!q) return true;
      return [r.blanket_number, r.customer_name, r.status, r.payment_terms]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search]);

  const selected = filtered.find((r) => r.id === selectedId) || filtered[0] || null;

  useEffect(() => {
    if (!selected?.id) {
      setDetail(null);
      return;
    }
    let mounted = true;
    setDetailLoading(true);
    api
      .get(`/blanket-pos/${selected.id}`)
      .then(({ data }) => {
        if (!mounted) return;
        setDetail(data.blanket_po || null);
      })
      .catch(() => {
        if (!mounted) return;
        setDetail(null);
      })
      .finally(() => {
        if (mounted) setDetailLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selected?.id]);

  const released = selected?.released_value || 0;
  const contract = selected?.contract_value || Math.max(released, 1);

  return (
    <main className="mes-shell">
      <PageHeader
        eyebrow="Sourcing"
        title="Blanket POs"
        subtitle="Active customer contracts with draw-down progress and locked part pricing."
        actions={
          <button
            type="button"
            className="mes-btn mes-btn-primary"
            onClick={() => navigate('/blanket-pos/add')}
          >
            <Plus size={16} />
            New contract
          </button>
        }
      />

      {error ? <p className="error-message">{error}</p> : null}

      {loading ? (
        <p className="muted">Loading contracts…</p>
      ) : !rows.length ? (
        <EmptyState
          icon={FileText}
          title="No blanket POs yet"
          description="Create a customer contract with a weekly delivery plan to start sourcing demand."
          actionLabel="New contract"
          onAction={() => navigate('/blanket-pos/add')}
        />
      ) : (
        <div className="mes-split">
          <div className="mes-card" style={{ padding: 16 }}>
            <input
              type="search"
              className="search-input"
              placeholder="Search contracts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', marginBottom: 12 }}
            />
            <div className="mes-split-list">
              {filtered.map((r) => {
                const rel = r.released_value || 0;
                const tot = r.contract_value || Math.max(rel, 1);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={`mes-list-item${selected?.id === r.id ? ' is-selected' : ''}`}
                    onClick={() => {
                      setSelectedId(r.id);
                      setShowSecondary(false);
                    }}
                  >
                    <div className="mes-list-item-top">
                      <p className="mes-list-item-title">{r.blanket_number}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mes-list-item-meta">
                      <TruncatedText>{r.customer_name || '—'}</TruncatedText>
                    </p>
                    <ProgressBar
                      value={rel}
                      max={tot}
                      label={`${formatMoney(rel)} / ${formatMoney(tot)}`}
                    />
                    <p className="mes-list-item-meta" style={{ marginTop: 8, marginBottom: 0 }}>
                      Exp.{' '}
                      {r.valid_to
                        ? formatDisplayDate(r.valid_to)
                        : r.status === 'draft'
                          ? 'Not activated'
                          : 'Open'}
                    </p>
                  </button>
                );
              })}
              {!filtered.length ? (
                <p className="muted" style={{ padding: 12 }}>
                  No matches.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mes-card mes-detail-panel">
            {!selected ? (
              <EmptyState title="Select a contract" description="Choose a blanket PO from the list." />
            ) : detailLoading ? (
              <p className="muted">Loading details…</p>
            ) : (
              <>
                <div className="mes-list-item-top">
                  <div>
                    <p className="mes-eyebrow">Contract</p>
                    <h2 style={{ margin: 0 }}>{selected.blanket_number}</h2>
                    <p className="muted" style={{ marginTop: 4 }}>
                      {selected.customer_name}
                    </p>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>

                <div className="mes-detail-grid">
                  <div>
                    <p className="mes-detail-label">Drawn down</p>
                    <p className="mes-detail-value">
                      {formatMoney(released)} / {formatMoney(contract)}
                    </p>
                  </div>
                  <div>
                    <p className="mes-detail-label">Valid to</p>
                    <p className="mes-detail-value">
                      {selected.valid_to ? formatDisplayDate(selected.valid_to) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="mes-detail-label">Lines</p>
                    <p className="mes-detail-value">{selected.line_count ?? 0}</p>
                  </div>
                  <div>
                    <p className="mes-detail-label">Currency</p>
                    <p className="mes-detail-value">{selected.currency || 'INR'}</p>
                  </div>
                </div>

                <ProgressBar value={released} max={contract} label="Contract draw-down" />

                <div style={{ marginTop: 20 }}>
                  <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Lines</h3>
                  {(detail?.lines || []).length ? (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                      {(detail.lines || []).map((line) => (
                        <li
                          key={line.id}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: 'var(--bg-raised)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <TruncatedText as="strong">{line.component_label || line.master_record_id}</TruncatedText>
                          <span className="muted">
                            ₹{Number(line.unit_price).toLocaleString('en-IN')} · released{' '}
                            {line.released_qty}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No lines on this contract.</p>
                  )}
                </div>

                <button
                  type="button"
                  className="mes-btn mes-btn-secondary"
                  style={{ marginTop: 16 }}
                  onClick={() => setShowSecondary((v) => !v)}
                >
                  {showSecondary ? 'Hide secondary terms' : 'Show secondary terms'}
                </button>
                {showSecondary ? (
                  <div className="mes-detail-grid" style={{ marginTop: 12 }}>
                    <div>
                      <p className="mes-detail-label">Payment terms</p>
                      <p className="mes-detail-value">{selected.payment_terms || '—'}</p>
                    </div>
                    <div>
                      <p className="mes-detail-label">Valid from</p>
                      <p className="mes-detail-value">
                        {selected.valid_from ? formatDisplayDate(selected.valid_from) : '—'}
                      </p>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <p className="mes-detail-label">Notes</p>
                      <p className="mes-detail-value">{selected.notes || '—'}</p>
                    </div>
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="mes-btn mes-btn-primary"
                    onClick={() => navigate(`/blanket-pos/${selected.id}`)}
                  >
                    Open contract
                    <ChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="mes-btn mes-btn-secondary"
                    onClick={() => navigate('/delivery-schedules')}
                  >
                    View schedules
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
