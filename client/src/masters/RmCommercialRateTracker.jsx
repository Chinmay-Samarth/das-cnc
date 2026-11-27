import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../api/client';
import { EmptyState, Skeleton } from '../components/mes';
import { CHART, DashChartTooltip, formatInr, formatShortDate } from '../home/dashboard/chartUtils';

const SERIES_COLORS = [
  CHART.billed,
  CHART.good,
  CHART.girn,
  CHART.po,
  CHART.campaignRisk,
  '#db2777',
  '#0891b2',
];

function formatRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function RateTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <DashChartTooltip
      title={label}
      rows={payload.map((p) => ({
        label: p.name,
        value: formatRate(p.value),
        color: p.color,
      }))}
    />
  );
}

function buildFlatTimeline(currentRows) {
  const withRates = (currentRows || []).filter(
    (row) => row?.supplier_id && Number.isFinite(Number(row.rate))
  );
  if (!withRates.length) return [];

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  const startYmd = start.toISOString().slice(0, 10);
  const endYmd = end.toISOString().slice(0, 10);

  const startPoint = { ymd: startYmd, label: formatShortDate(startYmd) };
  const endPoint = { ymd: endYmd, label: formatShortDate(endYmd) };
  for (const row of withRates) {
    const rate = Number(row.rate);
    startPoint[row.supplier_id] = rate;
    endPoint[row.supplier_id] = rate;
  }
  return [startPoint, endPoint];
}

function SupplierRateChart({ supplier, data, color, yDomain, hasHistory }) {
  const series = useMemo(
    () =>
      (data || [])
        .map((point) => ({
          ymd: point.ymd,
          label: point.label,
          rate: point[supplier.id],
        }))
        .filter((point) => Number.isFinite(Number(point.rate))),
    [data, supplier.id]
  );

  if (!series.length) {
    return (
      <div className="rm-rate-chart rm-rate-chart-card">
        <div className="rm-rate-chart-title">{supplier.name}</div>
        <p className="muted">No rate points yet</p>
      </div>
    );
  }

  return (
    <div className="rm-rate-chart rm-rate-chart-card">
      <div className="rm-rate-chart-title">{supplier.name}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART.axis, fontSize: 11 }}
            axisLine={{ stroke: CHART.grid }}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: CHART.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v) => formatInr(v)}
          />
          <Tooltip content={<RateTooltip />} />
          <Line
            type="monotone"
            dataKey="rate"
            name={supplier.name}
            stroke={color}
            strokeWidth={2}
            dot={{ r: hasHistory ? 3 : 2 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function RmCommercialRateTracker({ slug, recordId, repeatableRows = [] }) {
  const [current, setCurrent] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    api
      .get(`/masters/${slug}/records/${recordId}/rate-history`)
      .then(({ data }) => {
        if (!mounted) return;
        setCurrent(Array.isArray(data?.current) ? data.current : []);
        setHistory(Array.isArray(data?.history) ? data.history : []);
      })
      .catch((err) => {
        if (!mounted) return;
        const fallback = (repeatableRows || [])
          .map((row) => {
            const supplierId = row?.source?.linked_record_id || row?.source?.value || null;
            const rate = Number(row?.rate?.value);
            const tax = Number(row?.tax_gst?.value);
            if (!supplierId || !Number.isFinite(rate)) return null;
            return {
              supplier_id: supplierId,
              supplier_name: row?.source?._label || null,
              rate,
              tax_gst: Number.isFinite(tax) ? tax : null,
            };
          })
          .filter(Boolean);
        setCurrent(fallback);
        setHistory([]);
        setError(err.response?.data?.error || null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [slug, recordId, repeatableRows]);

  const suppliers = useMemo(() => {
    const map = new Map();
    for (const row of current) {
      if (!row?.supplier_id) continue;
      map.set(row.supplier_id, row.supplier_name || 'Supplier');
    }
    for (const row of history) {
      if (!row?.supplier_id) continue;
      if (!map.has(row.supplier_id)) {
        map.set(row.supplier_id, row.supplier_name || 'Supplier');
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [current, history]);

  const chartData = useMemo(() => {
    if (history.length) {
      const byDay = new Map();
      for (const row of history) {
        const ymd = String(row.observed_at || '').slice(0, 10);
        if (!ymd || row.rate == null) continue;
        if (!byDay.has(ymd)) {
          byDay.set(ymd, { ymd, label: formatShortDate(ymd) });
        }
        byDay.get(ymd)[row.supplier_id] = Number(row.rate);
      }
      return [...byDay.values()].sort((a, b) => a.ymd.localeCompare(b.ymd));
    }
    return buildFlatTimeline(current);
  }, [history, current]);

  const yDomain = useMemo(() => {
    const values = [];
    for (const point of chartData) {
      for (const supplier of suppliers) {
        const n = Number(point[supplier.id]);
        if (Number.isFinite(n)) values.push(n);
      }
    }
    if (!values.length) return ['auto', 'auto'];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) {
      const pad = Math.max(Math.abs(min) * 0.1, 1);
      return [Math.max(0, min - pad), max + pad];
    }
    const pad = (max - min) * 0.12;
    return [Math.max(0, min - pad), max + pad];
  }, [chartData, suppliers]);

  if (loading) {
    return (
      <div className="rm-rate-tracker" aria-busy="true">
        <Skeleton height={28} width="40%" />
        <Skeleton height={160} radius={12} />
        <div className="rm-rate-chart-grid">
          <Skeleton height={220} radius={12} />
          <Skeleton height={220} radius={12} />
        </div>
      </div>
    );
  }

  if (!current.length && !history.length) {
    return (
      <EmptyState
        title="No commercial rates yet"
        description="When purchase invoices are confirmed and line items map to this raw material, supplier rates appear here."
      />
    );
  }

  return (
    <div className="rm-rate-tracker">
      {error ? <p className="muted rm-rate-tracker-note">{error}</p> : null}

      <div className="rm-rate-tracker-block">
        <div className="rm-rate-tracker-head">
          <h3>Current supplier rates</h3>
          <p className="muted">Latest rate per supplier from commercials</p>
        </div>
        <div className="app-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th className="col-sno">#</th>
                <th>Supplier</th>
                <th>Rate</th>
                <th>Tax GST %</th>
              </tr>
            </thead>
            <tbody>
              {current.map((row, idx) => (
                <tr key={row.supplier_id || idx}>
                  <td className="col-sno">{idx + 1}</td>
                  <td>{row.supplier_name || row.supplier_id || '—'}</td>
                  <td>{formatRate(row.rate)}</td>
                  <td>
                    {row.tax_gst == null || row.tax_gst === ''
                      ? '—'
                      : `${Number(row.tax_gst).toLocaleString('en-IN', {
                          maximumFractionDigits: 2,
                        })}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rm-rate-tracker-block">
        <div className="rm-rate-tracker-head">
          <h3>Rate tracker</h3>
          <p className="muted">
            {history.length
              ? 'Compare supplier rate timelines side by side'
              : 'Current rates shown as flat lines until invoice history builds'}
          </p>
        </div>
        {!chartData.length || !suppliers.length ? (
          <EmptyState
            title="No rates to chart"
            description="Add a commercial rate or confirm a mapped purchase invoice to show the timeline."
          />
        ) : (
          <div className="rm-rate-chart-grid">
            {suppliers.map((supplier, idx) => (
              <SupplierRateChart
                key={supplier.id}
                supplier={supplier}
                data={chartData}
                color={SERIES_COLORS[idx % SERIES_COLORS.length]}
                yDomain={yDomain}
                hasHistory={history.length > 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
