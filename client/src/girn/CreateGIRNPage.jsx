import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import EmployeeSelect from './EmployeeSelect';
import GIRNInvoiceUpload from './GIRNInvoiceUpload';
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

function toNumber(value) {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function calcItem(item) {
  const quantity = toNumber(item.quantity);
  const unitRate = toNumber(item.unit_rate);
  const vatPercentage = toNumber(item.vat_percentage);
  const amount = quantity * unitRate;
  const vatAmount = amount * (vatPercentage / 100);
  const totalAmount = amount + vatAmount;

  return {
    ...item,
    amount: amount.toFixed(2),
    vat_amount: vatAmount.toFixed(2),
    total_amount: totalAmount.toFixed(2),
  };
}

function fmt(value) {
  const number = parseFloat(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
}

function normalizeDraftItems(items = []) {
  if (!items.length) return [{ ...EMPTY_ITEM }];
  return items.map((item) => calcItem({ ...EMPTY_ITEM, ...item }));
}

function HeaderReview({
  header,
  suppliers,
  employees,
  user,
  onChange,
  onReceivedByChange,
  onSupplierSelect,
}) {
  const [overrideEmployee, setOverrideEmployee] = useState(false);
  const selectedEmployee = employees.find((e) => String(e.id) === String(header.received_by));
  const employeeLabel = selectedEmployee
    ? `${selectedEmployee.full_name}${selectedEmployee.employee_code ? ` (${selectedEmployee.employee_code})` : ''}`
    : user?.name
      ? `${user.name}${user.code ? ` (${user.code})` : ''}`
      : 'Select employee';

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <h2>Review GIRN Header</h2>
          <p className="muted">OCR filled these fields from the invoice. Correct anything before registering.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        <label>
          Supplier Name <span style={{ color: '#b91c1c' }}>*</span>
          <input
            type="text"
            name="supplier_name"
            value={header.supplier_name || ''}
            onChange={onChange}
            required={!header.supplier_id}
            disabled={Boolean(header.supplier_id)}
          />
        </label>

        <label>
          GSTIN
          <input
            type="text"
            name="supplier_gstin"
            value={header.supplier_gstin || ''}
            onChange={onChange}
            disabled={Boolean(header.supplier_id)}
          />
        </label>

        <label>
          Link existing supplier
          <select
            name="supplier_id"
            value={header.supplier_id}
            onChange={onSupplierSelect}
          >
            <option value="">Create from OCR details above</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </label>

        <label>
          PO / Invoice Reference
          <input
            type="text"
            name="po_reference"
            value={header.po_reference}
            onChange={onChange}
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
          CSR
          <input
            type="text"
            name="csr"
            value={header.csr}
            onChange={onChange}
          />
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <p className="component-detail-label">Received By</p>
        {!overrideEmployee ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{employeeLabel}</strong>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setOverrideEmployee(true)}
            >
              Change employee
            </button>
          </div>
        ) : (
          <EmployeeSelect value={header.received_by} onChange={onReceivedByChange} />
        )}
      </div>

      <label style={{ marginTop: 16 }}>
        Notes
        <textarea
          name="notes"
          value={header.notes}
          onChange={onChange}
          rows={3}
        />
      </label>
    </div>
  );
}

function ItemsReview({ items, onItemChange, onRawMaterialSelect, onAddItem, onRemoveItem }) {
  const grandTotal = items.reduce((sum, item) => sum + toNumber(item.total_amount), 0);

  return (
    <div className="card">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <h2>Review Line Items</h2>
          <p className="muted">Match OCR rows to raw materials. New RM ID + RM Code pairs will be created in the raw material master.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onAddItem}>
          + Add Item
        </button>
      </div>

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
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <strong>Item {idx + 1}</strong>
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
            <label style={{ gridColumn: '1 / -1' }}>
              Match existing raw material
              <RawMaterialSelect
                value={item.raw_material_id}
                label={item.raw_material_label}
                onChange={(mapped) => onRawMaterialSelect(idx, mapped)}
              />
            </label>

            <label>
              RM ID <span style={{ color: '#b91c1c' }}>*</span>
              <input
                type="text"
                value={item.rm_id}
                onChange={(e) => onItemChange(idx, 'rm_id', e.target.value)}
                placeholder="e.g. 1102"
              />
            </label>

            <label>
              RM Code <span style={{ color: '#b91c1c' }}>*</span>
              <input
                type="text"
                value={item.rm_code}
                onChange={(e) => onItemChange(idx, 'rm_code', e.target.value)}
                placeholder="e.g. copper"
              />
            </label>

            <label>
              Grade
              <input
                type="text"
                value={item.grade}
                onChange={(e) => onItemChange(idx, 'grade', e.target.value)}
              />
            </label>

            <label>
              Inventory Number
              <input
                type="text"
                value={item.inventory_number}
                onChange={(e) => onItemChange(idx, 'inventory_number', e.target.value)}
              />
            </label>

            <label>
              Unit
              <input
                type="text"
                value={item.unit}
                onChange={(e) => onItemChange(idx, 'unit', e.target.value)}
              />
            </label>

            <label>
              Quantity <span style={{ color: '#b91c1c' }}>*</span>
              <input
                type="number"
                min="0"
                step="any"
                value={item.quantity}
                onChange={(e) => onItemChange(idx, 'quantity', e.target.value)}
              />
            </label>

            <label>
              Unit Rate
              <input
                type="number"
                min="0"
                step="any"
                value={item.unit_rate}
                onChange={(e) => onItemChange(idx, 'unit_rate', e.target.value)}
              />
            </label>

            <label>
              GST %
              <input
                type="number"
                min="0"
                step="any"
                value={item.vat_percentage}
                onChange={(e) => onItemChange(idx, 'vat_percentage', e.target.value)}
              />
            </label>
          </div>

          {!item.raw_material_id && item.rm_id && item.rm_code ? (
            <p className="muted" style={{ marginTop: 8, color: '#854d0e' }}>
              This raw material will be created in the raw material master if RM ID {item.rm_id} does not already exist.
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
            <span>Amount: <strong>₹{fmt(item.amount)}</strong></span>
            <span>GST: <strong>₹{fmt(item.vat_amount)}</strong></span>
            <span>Total: <strong>₹{fmt(item.total_amount)}</strong></span>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <strong>Grand Total: ₹{fmt(grandTotal)}</strong>
      </div>
    </div>
  );
}

export default function CreateGIRNPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [step, setStep] = useState('scan');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [header, setHeader] = useState({
    invoice_id: '',
    supplier_id: '',
    supplier_name: '',
    supplier_gstin: '',
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

  useEffect(() => {
    if (user?.id && !header.received_by) {
      setHeader((prev) => ({ ...prev, received_by: user.id }));
    }
  }, [user, header.received_by]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => String(employee.id) === String(header.received_by)),
    [employees, header.received_by]
  );

  function handleExtracted(data) {
    const draft = data.draft_girn || {};
    setInvoice(data.invoice || null);
    api.get('/suppliers').then(({ data: supplierData }) => setSuppliers(supplierData.suppliers || []));
    setHeader((prev) => ({
      ...prev,
      invoice_id: draft.invoice_id || data.invoice?.id || '',
      supplier_id: draft.supplier_id || data.invoice?.supplier_id || '',
      supplier_name: draft.supplier_name || '',
      supplier_gstin: draft.supplier_gstin || '',
      po_reference: draft.po_reference || '',
      received_date: draft.received_date || new Date().toISOString().slice(0, 10),
      received_by: user?.id || draft.received_by || prev.received_by,
      csr: draft.csr || '',
      notes: draft.notes || '',
    }));
    setItems(normalizeDraftItems(draft.items));
    setStep('review');
  }

  function handleHeaderChange(event) {
    const { name, value } = event.target;
    setHeader((prev) => ({ ...prev, [name]: value }));
  }

  function handleSupplierSelect(event) {
    const supplierId = event.target.value;
    if (!supplierId) {
      setHeader((prev) => ({ ...prev, supplier_id: '' }));
      return;
    }

    const supplier = suppliers.find((entry) => String(entry.id) === String(supplierId));
    setHeader((prev) => ({
      ...prev,
      supplier_id: supplierId,
      supplier_name: supplier?.name || prev.supplier_name,
      supplier_gstin: supplier?.GSTIN || prev.supplier_gstin,
    }));
  }

  function handleRawMaterialSelect(idx, mapped) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = calcItem({
        ...next[idx],
        raw_material_id: mapped.raw_material_id,
        raw_material_label: mapped.raw_material_label,
        rm_id: mapped.rm_id || next[idx].rm_id,
        rm_code: mapped.rm_code || next[idx].rm_code,
        grade: mapped.grade || next[idx].grade,
        unit: mapped.unit || next[idx].unit,
        inventory_number: mapped.inventory_number || next[idx].inventory_number,
      });
      return next;
    });
  }

  function handleItemChange(idx, field, value) {
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[idx], [field]: value };
      if (field === 'rm_id' || field === 'rm_code') {
        item.raw_material_id = null;
        item.raw_material_label = '';
      }
      next[idx] = calcItem(item);
      return next;
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, itemIdx) => itemIdx !== idx));
  }

  const canRegister =
    (header.supplier_id || String(header.supplier_name || '').trim()) &&
    header.received_by &&
    header.received_date &&
    items.length > 0 &&
    items.every(
      (item) =>
        (item.raw_material_id || (String(item.rm_id).trim() && String(item.rm_code).trim())) &&
        toNumber(item.quantity) > 0
    );

  async function registerGirn(submitForInspection = false) {
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        ...header,
        items: items.map((item) => ({
          raw_material_id: item.raw_material_id || null,
          rm_id: item.rm_id || null,
          rm_code: item.rm_code || null,
          grade: item.grade || null,
          inventory_number: item.inventory_number || null,
          unit: item.unit || null,
          quantity: toNumber(item.quantity),
          unit_rate: toNumber(item.unit_rate),
          vat_percentage: toNumber(item.vat_percentage),
          amount: toNumber(item.amount),
          vat_amount: toNumber(item.vat_amount),
          total_amount: toNumber(item.total_amount),
        })),
      };

      const { data } = await api.post('/girn', payload);
      const newId = data.girn.id;
      if (submitForInspection) {
        await api.post(`/girn/${newId}/submit`);
      }
      navigate(`/girn/${newId}`);
    } catch (err) {
      console.error('GIRN register error:', err);
      setError(err.response?.data?.error || 'Unable to register GIRN.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell employees-page">
      <header className="app-header">
        <div className="header-title-block">
          <p className="eyebrow">Procurement</p>
          <h1>New GIRN</h1>
          <p className="muted">Upload a scanned invoice, review OCR details, then register the GIRN.</p>
        </div>
      </header>

      <section className="card form-card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap', alignItems: 'center' }}>
          {['Scan Invoice', 'Review Details', 'Register GIRN'].map((label, idx) => {
            const currentIdx = step === 'scan' ? 0 : 1;
            const isActive = idx === currentIdx || (idx === 2 && submitting);
            const isDone = idx < currentIdx;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isActive || isDone ? 1 : 0.45 }}>
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
                  }}
                >
                  {isDone ? '✓' : idx + 1}
                </span>
                <span style={{ fontSize: 14, fontWeight: isActive ? 700 : 400 }}>{label}</span>
                {idx < 2 ? <span style={{ color: '#d1d5db' }}>›</span> : null}
              </div>
            );
          })}
        </div>

        {error ? <p className="error-message" style={{ marginBottom: 16 }}>{error}</p> : null}

        {step === 'scan' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="card">
              <h2>1. Confirm receiver</h2>
              <p className="muted">The receiver is taken from the logged-in user. Change it only if needed.</p>
              <div style={{ marginTop: 12 }}>
                <p className="component-detail-label">Received By</p>
                <strong>
                  {selectedEmployee
                    ? `${selectedEmployee.full_name}${selectedEmployee.employee_code ? ` (${selectedEmployee.employee_code})` : ''}`
                    : user?.name
                      ? `${user.name}${user.code ? ` (${user.code})` : ''}`
                      : 'Not selected'}
                </strong>
                <div style={{ maxWidth: 360, marginTop: 12 }}>
                  <EmployeeSelect
                    value={header.received_by}
                    onChange={(employeeId) => setHeader((prev) => ({ ...prev, received_by: employeeId }))}
                  />
                </div>
              </div>
            </div>

            <div className="card">
              <h2>2. Upload scanned invoice</h2>
              <p className="muted">Mindee will extract supplier, invoice, and line item details for review.</p>
              <div style={{ marginTop: 16 }}>
                <GIRNInvoiceUpload
                  disabled={!header.received_by}
                  onExtracted={handleExtracted}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            {invoice ? (
              <div className="card" style={{ marginBottom: 16 }}>
                <h2>Invoice Added</h2>
                <p className="muted">
                  Invoice {invoice.invoice_number || invoice.id} has been added to the Invoices tab.
                </p>
                {invoice.file_url ? (
                  <a href={invoice.file_url} target="_blank" rel="noreferrer" className="primary-button" style={{ display: 'inline-block', marginTop: 8 }}>
                    View scanned invoice
                  </a>
                ) : null}
              </div>
            ) : null}

            <HeaderReview
              header={header}
              suppliers={suppliers}
              employees={employees}
              user={user}
              onChange={handleHeaderChange}
              onSupplierSelect={handleSupplierSelect}
              onReceivedByChange={(employeeId) => setHeader((prev) => ({ ...prev, received_by: employeeId }))}
            />

            <ItemsReview
              items={items}
              onItemChange={handleItemChange}
              onRawMaterialSelect={handleRawMaterialSelect}
              onAddItem={addItem}
              onRemoveItem={removeItem}
            />

            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep('scan')}
                disabled={submitting}
              >
                Upload different invoice
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!canRegister || submitting}
                onClick={() => registerGirn(false)}
              >
                {submitting ? 'Registering...' : 'Register GIRN'}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!canRegister || submitting}
                onClick={() => registerGirn(true)}
              >
                {submitting ? 'Submitting...' : 'Register & Submit for Inspection'}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
