import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import EmployeeSelect from './EmployeeSelect';
import RawMaterialSelect from './RawMaterialSelect';

const EMPTY_ITEM = {
  raw_material_id: null,
  raw_material_label: '',
  rm_id: '',
  rm_code: '',
  grade: '',
  inventory_number: '',
  unit: '',
  quantity: '',
  unit_rate: '',
  vat_percentage: '',
  amount: '',
  vat_amount: '',
  total_amount: '',
};

function calcItem(item) {
  const qty = parseFloat(item.quantity) || 0;
  const rate = parseFloat(item.unit_rate) || 0;
  const vatPct = parseFloat(item.vat_percentage) || 0;
  const amount = qty * rate;
  const vatAmount = amount * (vatPct / 100);
  const totalAmount = amount + vatAmount;
  return {
    ...item,
    amount: amount.toFixed(2),
    vat_amount: vatAmount.toFixed(2),
    total_amount: totalAmount.toFixed(2),
  };
}

function fmt(val) {
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Step1({ header, suppliers, onChange, onReceivedByChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <label>
        Supplier <span style={{ color: '#b91c1c' }}>*</span>
        <select
          name="supplier_id"
          value={header.supplier_id}
          onChange={onChange}
          required
        >
          <option value="">Select supplier...</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <label>
        PO Reference
        <input
          type="text"
          name="po_reference"
          value={header.po_reference}
          onChange={onChange}
          placeholder="e.g. PO-2025-001"
        />
      </label>

      <label>
        Received Date <span style={{ color: '#b91c1c' }}>*</span>
        <input
          type="date"
          name="received_date"
          value={header.received_date}
          onChange={onChange}
          required
        />
      </label>

      <label>
        Received By <span style={{ color: '#b91c1c' }}>*</span>
        <EmployeeSelect
          value={header.received_by}
          onChange={onReceivedByChange}
        />
      </label>

      <label>
        CSR
        <input
          type="text"
          name="csr"
          value={header.csr}
          onChange={onChange}
          placeholder="Customer Specific Requirement"
        />
      </label>

      <label>
        Notes
        <textarea
          name="notes"
          value={header.notes}
          onChange={onChange}
          rows={3}
          placeholder="Any additional notes..."
        />
      </label>
    </div>
  );
}

function Step2({ items, onItemChange, onRawMaterialSelect, onAddItem, onRemoveItem }) {
  const grandTotal = items.reduce((sum, i) => sum + (parseFloat(i.total_amount) || 0), 0);

  return (
    <div>
      {items.map((item, idx) => (
        <div
          key={idx}
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            background: '#fafafa',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <strong style={{ fontSize: 14 }}>Item {idx + 1}</strong>
            {items.length > 1 ? (
              <button
                type="button"
                className="secondary-button"
                style={{ fontSize: 12, padding: '2px 10px' }}
                onClick={() => onRemoveItem(idx)}
              >
                Remove
              </button>
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <label style={{ fontSize: 13 }}>
              RM ID <span style={{ color: '#b91c1c' }}>*</span>
              <input
                type="text"
                value={item.rm_id}
                onChange={(e) => onItemChange(idx, 'rm_id', e.target.value)}
                placeholder="e.g. 1102"
              />
            </label>

            <label style={{ fontSize: 13 }}>
              RM Code <span style={{ color: '#b91c1c' }}>*</span>
              <input
                type="text"
                value={item.rm_code || item.raw_material_id}
                onChange={(e) => onItemChange(idx, 'rm_code', e.target.value)}
                placeholder="e.g. copper"
              />
            </label>

            <label style={{ fontSize: 13, gridColumn: '1 / -1' }}>
              Search existing raw material
              <RawMaterialSelect
                value={item.raw_material_id}
                label={item.raw_material_label}
                onChange={(mapped) => onRawMaterialSelect(idx, mapped)}
              />
              {!item.raw_material_id && item.rm_id && item.rm_code ? (
                <span style={{ fontSize: 12, color: '#854d0e', marginTop: 4, display: 'block' }}>
                  New material will be added to raw material master when GIRN is saved.
                </span>
              ) : null}
            </label>

            <label style={{ fontSize: 13 }}>
              Grade
              <input
                type="text"
                value={item.grade}
                onChange={(e) => onItemChange(idx, 'grade', e.target.value)}
                placeholder="e.g. SS304"
              />
            </label>

            <label style={{ fontSize: 13 }}>
              Inventory Number
              <input
                type="text"
                value={item.inventory_number}
                onChange={(e) => onItemChange(idx, 'inventory_number', e.target.value)}
              />
            </label>

            <label style={{ fontSize: 13 }}>
              Unit
              <input
                type="text"
                value={item.unit}
                onChange={(e) => onItemChange(idx, 'unit', e.target.value)}
                placeholder="kg / pcs / m"
              />
            </label>

            <label style={{ fontSize: 13 }}>
              Quantity <span style={{ color: '#b91c1c' }}>*</span>
              <input
                type="number"
                min="0"
                step="any"
                value={item.quantity}
                onChange={(e) => onItemChange(idx, 'quantity', e.target.value)}
              />
            </label>

            <label style={{ fontSize: 13 }}>
              Unit Rate (₹) <span style={{ color: '#b91c1c' }}>*</span>
              <input
                type="number"
                min="0"
                step="any"
                value={item.unit_rate}
                onChange={(e) => onItemChange(idx, 'unit_rate', e.target.value)}
              />
            </label>

            <label style={{ fontSize: 13 }}>
              VAT %
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={item.vat_percentage}
                onChange={(e) => onItemChange(idx, 'vat_percentage', e.target.value)}
              />
            </label>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 24,
              marginTop: 10,
              paddingTop: 10,
              borderTop: '1px solid #e5e7eb',
              fontSize: 13,
              color: '#374151',
              flexWrap: 'wrap',
            }}
          >
            <span>Amount: <strong>₹{fmt(item.amount)}</strong></span>
            <span>VAT: <strong>₹{fmt(item.vat_amount)}</strong></span>
            <span>Total: <strong>₹{fmt(item.total_amount)}</strong></span>
          </div>
        </div>
      ))}

      <button type="button" className="secondary-button" onClick={onAddItem}>
        + Add Item
      </button>

      <div
        style={{
          marginTop: 16,
          padding: '12px 16px',
          background: '#f0fdf4',
          borderRadius: 8,
          border: '1px solid #bbf7d0',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: '#166534' }}>
          Grand Total: ₹{fmt(grandTotal)}
        </span>
      </div>
    </div>
  );
}

function Step3({ header, suppliers, items, employees }) {
  const grandTotal = items.reduce((sum, i) => sum + (parseFloat(i.total_amount) || 0), 0);
  const supplierName = suppliers.find((s) => String(s.id) === String(header.supplier_id))?.name || '—';
  const receivedByEmployee = employees.find((e) => String(e.id) === String(header.received_by));
  const receivedByLabel = receivedByEmployee
    ? `${receivedByEmployee.full_name}${receivedByEmployee.employee_code ? ` (${receivedByEmployee.employee_code})` : ''}`
    : '—';

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Header Summary</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          {[
            ['Supplier', supplierName],
            ['PO Reference', header.po_reference || '—'],
            ['Received Date', header.received_date || '—'],
            ['Received By', receivedByLabel],
            ['CSR', header.csr || '—'],
            ['Notes', header.notes || '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="component-detail-label">{label}</p>
              <p className="component-detail-value">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="employees-table-wrap">
        <table className="employees-table">
          <thead>
            <tr>
              <th>#</th>
              <th>RM ID</th>
              <th>RM Code</th>
              <th>Grade</th>
              <th>Unit</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>VAT %</th>
              <th>Amount</th>
              <th>VAT Amt</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx}>
                <td>{idx + 1}</td>
                <td>{item.rm_id || item.raw_material_label || '—'}</td>
                <td>{item.rm_code || '—'}</td>
                <td>{item.grade || '—'}</td>
                <td>{item.unit || '—'}</td>
                <td>{item.quantity || '—'}</td>
                <td>₹{fmt(item.unit_rate)}</td>
                <td>{item.vat_percentage || '0'}%</td>
                <td>₹{fmt(item.amount)}</td>
                <td>₹{fmt(item.vat_amount)}</td>
                <td><strong>₹{fmt(item.total_amount)}</strong></td>
              </tr>
            ))}
            <tr>
              <td colSpan={10} style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total</td>
              <td><strong>₹{fmt(grandTotal)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CreateGIRNPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [suppliers, setSuppliers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [header, setHeader] = useState({
    supplier_id: '',
    po_reference: '',
    received_date: new Date().toISOString().slice(0, 10),
    received_by: '',
    csr: '',
    notes: '',
  });

  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);

  useEffect(() => {
    api.get('/suppliers').then(({ data }) => setSuppliers(data.suppliers || []));
    api.get('/employees').then(({ data }) => setEmployees(data.employees || []));
  }, []);

  const handleHeaderChange = (e) => {
    const { name, value } = e.target;
    setHeader((prev) => ({ ...prev, [name]: value }));
  };

  const handleRawMaterialSelect = (idx, mapped) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = calcItem({
        ...updated[idx],
        raw_material_id: mapped.raw_material_id,
        raw_material_label: mapped.raw_material_label,
        rm_id: mapped.rm_id || updated[idx].rm_id,
        rm_code: mapped.rm_code || updated[idx].rm_code,
        grade: mapped.grade || updated[idx].grade,
        unit: mapped.unit || updated[idx].unit,
        inventory_number: mapped.inventory_number || updated[idx].inventory_number,
      });
      return updated;
    });
  };

  const handleItemChange = (idx, field, value) => {
    setItems((prev) => {
      const updated = [...prev];
      const next = { ...updated[idx], [field]: value };
      if (field === 'rm_id' || field === 'rm_code') {
        next.raw_material_id = null;
        next.raw_material_label = '';
      }
      updated[idx] = calcItem(next);
      return updated;
    });
  };

  const addItem = () => setItems((prev) => [...prev, { ...EMPTY_ITEM }]);

  const removeItem = (idx) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const canAdvanceStep1 =
    header.supplier_id && header.received_date && header.received_by;

  const canAdvanceStep2 =
    items.length > 0 &&
    items.every(
      (i) =>
        (i.raw_material_id || (String(i.rm_id).trim() && String(i.rm_code).trim())) &&
        parseFloat(i.quantity) > 0 &&
        parseFloat(i.unit_rate) >= 0
    );

  async function submit(submitForInspection = false) {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        ...header,
        items: items.map((i) => ({
          raw_material_id: i.raw_material_id || null,
          rm_id: i.rm_id || null,
          rm_code: i.rm_code || null,
          grade: i.grade || null,
          inventory_number: i.inventory_number || null,
          unit: i.unit || null,
          quantity: parseFloat(i.quantity) || 0,
          unit_rate: parseFloat(i.unit_rate) || 0,
          vat_percentage: parseFloat(i.vat_percentage) || 0,
          amount: parseFloat(i.amount) || 0,
          vat_amount: parseFloat(i.vat_amount) || 0,
          total_amount: parseFloat(i.total_amount) || 0,
        })),
      };

      const { data } = await api.post('/girn', payload);
      const newId = data.girn.id;

      if (submitForInspection) {
        await api.post(`/girn/${newId}/submit`);
      }

      navigate(`/girn/${newId}`);
    } catch (err) {
      console.error('GIRN create error:', err);
      setError(err.response?.data?.error || 'Unable to create GIRN. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const STEP_LABELS = ['Header', 'Line Items', 'Review & Submit'];

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Procurement</p>
          <h1>New GIRN</h1>
          <p className="muted">Record a new Goods Inwards Receipt Note.</p>
        </div>
      </header>

      <section className="card form-card">
        {/* Step indicator */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 28,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            const isActive = step === num;
            const isDone = step > num;
            return (
              <div
                key={num}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: isActive || isDone ? 1 : 0.4,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: isActive ? '#1d4ed8' : isDone ? '#16a34a' : '#d1d5db',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {isDone ? '✓' : num}
                </span>
                <span style={{ fontSize: 14, fontWeight: isActive ? 700 : 400 }}>{label}</span>
                {i < STEP_LABELS.length - 1 ? (
                  <span style={{ color: '#d1d5db', marginLeft: 4 }}>›</span>
                ) : null}
              </div>
            );
          })}
        </div>

        {error ? <p className="error-message" style={{ marginBottom: 16 }}>{error}</p> : null}

        {step === 1 ? (
          <Step1
            header={header}
            suppliers={suppliers}
            onChange={handleHeaderChange}
            onReceivedByChange={(employeeId) =>
              setHeader((prev) => ({ ...prev, received_by: employeeId }))
            }
          />
        ) : step === 2 ? (
          <Step2
            items={items}
            onItemChange={handleItemChange}
            onRawMaterialSelect={handleRawMaterialSelect}
            onAddItem={addItem}
            onRemoveItem={removeItem}
          />
        ) : (
          <Step3 header={header} suppliers={suppliers} items={items} employees={employees} />
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          {step > 1 ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep((s) => s - 1)}
              disabled={submitting}
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/girn')}
              disabled={submitting}
            >
              Cancel
            </button>
          )}

          {step === 1 ? (
            <button
              type="button"
              className="primary-button"
              disabled={!canAdvanceStep1}
              onClick={() => setStep(2)}
            >
              Next: Line Items
            </button>
          ) : step === 2 ? (
            <button
              type="button"
              className="primary-button"
              disabled={!canAdvanceStep2}
              onClick={() => setStep(3)}
            >
              Next: Review
            </button>
          ) : (
            <>
              <button
                type="button"
                className="secondary-button"
                disabled={submitting}
                onClick={() => submit(false)}
              >
                {submitting ? 'Saving...' : 'Save as Draft'}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={submitting}
                onClick={() => submit(true)}
              >
                {submitting ? 'Submitting...' : 'Submit for Inspection'}
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
