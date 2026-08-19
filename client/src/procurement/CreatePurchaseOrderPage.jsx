import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { FormActions, FormPage } from '../components/mes';
import { appAlert } from '../components/dialog';

const EMPTY_LINE = {
  item_category: 'raw_material',
  master_record_id: '',
  master_record_label: '',
  quantity: '',
  unit: 'kg',
  unit_rate: '',
  campaign_requirement: '',
  moq: '',
};

export default function CreatePurchaseOrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/suppliers').then(({ data }) => setSuppliers(data.suppliers || [])).catch(() => {});
    const masterId = searchParams.get('master_record_id');
    const cat = searchParams.get('item_category') || 'raw_material';
    if (masterId) {
      setLines([{ ...EMPTY_LINE, master_record_id: masterId, item_category: cat }]);
    }
  }, [searchParams]);

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        supplier_id: supplierId || null,
        notes,
        lines: lines
          .filter((l) => l.master_record_id && l.quantity)
          .map((l) => ({
            item_category: l.item_category,
            master_record_id: l.master_record_id,
            quantity: Number(l.quantity),
            unit: l.unit,
            unit_rate: Number(l.unit_rate) || 0,
            campaign_requirement: Number(l.campaign_requirement) || 0,
            moq: Number(l.moq) || 0,
          })),
      };
      const { data } = await api.post('/purchase-orders', payload);
      navigate(`/purchase-orders/${data.purchase_order.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to create PO.');
      await appAlert({ title: 'Create failed', message: err.response?.data?.error || 'Unable to create PO.', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage
      eyebrow="Procurement"
      title="New purchase order"
      subtitle="Create a draft PO."
      onBack={() => navigate('/purchase-orders')}
      backLabel="All POs"
      error={error}
    >
      <form onSubmit={handleSubmit}>
        <div className="form-page-grid">
          <label>
            Supplier
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={saving}>
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" disabled={saving} />
          </label>
        </div>

        <p className="form-page-section-title">Lines</p>
        {lines.map((line, idx) => (
          <div key={idx} className="form-page-grid" style={{ marginBottom: 8 }}>
            <label className="form-span-2">
              Master record UUID
              <input
                placeholder="Master record UUID"
                value={line.master_record_id}
                onChange={(e) => updateLine(idx, { master_record_id: e.target.value })}
                disabled={saving}
              />
            </label>
            <label>
              Quantity
              <input type="number" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} disabled={saving} />
            </label>
            <label>
              Unit
              <input value={line.unit} onChange={(e) => updateLine(idx, { unit: e.target.value })} disabled={saving} />
            </label>
            <label>
              MOQ
              <input type="number" value={line.moq} onChange={(e) => updateLine(idx, { moq: e.target.value })} disabled={saving} />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="neutral-button"
          onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}
          disabled={saving}
        >
          Add line
        </button>

        <FormActions
          saving={saving}
          onCancel={() => navigate('/purchase-orders')}
          saveLabel={saving ? 'Saving…' : 'Create draft PO'}
        />
      </form>
    </FormPage>
  );
}
