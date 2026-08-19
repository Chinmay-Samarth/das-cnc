import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { ArrowLeft } from 'lucide-react';
import { useSocket } from '../socket/socketContext';
import { formatDisplayDateTime } from '../utils/dateFormat';

const fmt = (val) =>
  val == null || isNaN(Number(val)) ? '—' : Number(val).toLocaleString('en-IN');

function formatDate(iso) {
  return formatDisplayDateTime(iso);
}

export default function StockDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { subscribe } = useSocket();
  const [stock, setStock] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [toolInstances, setToolInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const { data } = await api.get(`/inventory/stock/${id}`);
      setStock(data.stock);
      setLedger(data.ledger || []);
      if (data.stock?.item_category === 'tool' && data.stock?.master_record_id) {
        const ti = await api.get('/tool-instances', {
          params: { master_record_id: data.stock.master_record_id },
        });
        setToolInstances(ti.data.tool_instances || []);
      } else {
        setToolInstances([]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load stock detail.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribe('inventory:updated', (payload) => {
      if (
        !payload?.stockId ||
        payload.stockId === id ||
        (stock?.master_record_id && payload.masterRecordId === stock.master_record_id)
      ) {
        load({ silent: true });
      }
    });
  }, [subscribe, load, id, stock?.master_record_id]);

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
                        ) : entry.reason === 'backflush' ? (
                          <Link to={`/production/cards/${entry.reference_id}`}>
                          {entry.production_card_number || entry.note || 'Backflush'}
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

            {stock?.item_category === 'tool' && toolInstances.length > 0 ? (
              <div style={{ marginTop: 24 }}>
                <h3>Tool instances</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>Life remaining</th>
                      <th>Life total</th>
                      <th>Status</th>
                      <th>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolInstances.map((ti) => (
                      <tr key={ti.id}>
                        <td>{ti.serial_number}</td>
                        <td>{fmt(ti.life_remaining)}</td>
                        <td>{fmt(ti.life_total)}</td>
                        <td>{ti.status}</td>
                        <td>{formatDate(ti.received_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
