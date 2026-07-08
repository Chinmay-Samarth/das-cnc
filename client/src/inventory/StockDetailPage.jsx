import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { ArrowLeft } from 'lucide-react';

const fmt = (val) =>
  val == null || isNaN(Number(val)) ? '—' : Number(val).toLocaleString('en-IN');

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function StockDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stock, setStock] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get(`/inventory/stock/${id}`);
        if (!mounted) return;
        setStock(data.stock);
        setLedger(data.ledger || []);
      } catch (err) {
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load stock detail.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [id]);

  const masterLink = stock?.master_slug && stock?.master_record_id
    ? `/masters/${stock.master_slug}/records/${stock.master_record_id}`
    : null;

  return (
    <main className="app-shell employee-shell">
      <header className="app-header employee-card">
        <div className="header-title-block">
          <p
            onClick={() => navigate('/stock')}
            style={{ cursor: 'pointer' }}
          >
            <ArrowLeft size={16} style={{ marginRight: 4, display: 'inline' }} />
            Back to Stock
          </p>
          <p className="eyebrow">Inventory</p>
          <h1>{stock?.item_label || 'Stock detail'}</h1>
          {stock ? (
            <p className="muted">
              {stock.category_label} · Lot {stock.lot_number || '—'} · {fmt(stock.current_stock)} {stock.unit}
            </p>
          ) : null}
        </div>
      </header>

      <section className="card employee-main">
        {loading ? <p className="muted">Loading...</p> : null}
        {error ? <p className="error-message">{error}</p> : null}

        {!loading && stock ? (
          <>
            <div className="employee-detail-grid" style={{ marginBottom: 24, borderBottom: '' }}>
              <div>
                <p className="employee-detail-label">Category</p>
                <p className="employee-detail-value">{stock.category_label}</p>
              </div>
              <div>
                <p className="employee-detail-label">Current stock</p>
                <p className="employee-detail-value">{fmt(stock.current_stock)} {stock.unit}</p>
              </div>
              <div>
                <p className="employee-detail-label">Lot number</p>
                <p className="employee-detail-value">{stock.lot_number || '—'}</p>
              </div>
              <div>
                <p className="employee-detail-label">Master record</p>
                <p className="employee-detail-value">
                  {masterLink ? (
                    <Link to={masterLink}>{stock.item_label}</Link>
                  ) : (
                    stock.item_label
                  )}
                </p>
              </div>
            </div>


            <h2 className='card-header'>Movement history</h2>
            <div className="attendance-table-wrap">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Change</th>
                    <th>Balance after</th>
                    <th>Reason</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDate(entry.created_at)}</td>
                      <td style={{ color: Number(entry.change_qty) >= 0 ? '#166534' : '#991b1b', fontWeight: 600 }}>
                        {Number(entry.change_qty) >= 0 ? '+' : ''}{fmt(entry.change_qty)}
                      </td>
                      <td>{fmt(entry.balance_after)}</td>
                      <td>{entry.reason}</td>
                      <td className='neutral-button' style={{color: ' blue'}}>
                        {entry.reason === 'girn' && entry.reference_id ? (
                          <Link to={`/girn/${entry.reference_id}`}>
                            {entry.girn_number || entry.reference_id.slice(0, 8)}
                          </Link>
                        ) : (
                          entry.note || '—'
                        )}
                      </td>
                    </tr>
                  ))}
                  {ledger.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">No ledger entries yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
