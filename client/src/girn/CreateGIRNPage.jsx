import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import EmployeeSelect from './EmployeeSelect';
import GIRNInvoiceUpload from './GIRNInvoiceUpload';
import MasterItemSelect from './MasterItemSelect';
import { CATEGORY_OPTIONS, getCategoryConfig } from './girnCategoryConfig';

const EMPTY_ITEM = {
  item_category: 'raw_material',
  master_record_id: null,
  master_record_label: '',
  raw_material_id: null,
  raw_material_label: '',
  item_code: '',
  item_description: '',
  quantity_type: 'kg',
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
  match_confidence: '',
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
          {/* <p className="muted">OCR filled these fields from the invoice. Correct anything before registering.</p> */}
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

function ItemsReview({ items, onItemChange, onMasterSelect, onCategoryChange, onAddItem, onRemoveItem }) {
  const grandTotal = items.reduce((sum, item) => sum + toNumber(item.total_amount), 0);

  return (
    <div className="card">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <h2>Review Line Items</h2>
          <p className="muted">OCR suggests a category per line. Each stocked item must be linked to an existing master record.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onAddItem}>
          + Add Item
        </button>
      </div>

      {items.map((item, idx) => {
        const cfg = getCategoryConfig(item.item_category || 'raw_material');
        const isOther = item.item_category === 'other';

        return (
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
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>Item {idx + 1}</strong>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 99, background: '#e0e7ff', color: '#3730a3' }}>
                {cfg.quantityType === 'kg' ? 'kg' : 'nos'}
              </span>
              {item.match_confidence && item.match_confidence !== 'none' ? (
                <span className="muted" style={{ fontSize: 12 }}>OCR match: {item.match_confidence}</span>
              ) : null}
            </div>
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
            <label>
              Category <span style={{ color: '#b91c1c' }}>*</span>
              <select
                value={item.item_category || 'raw_material'}
                onChange={(e) => onCategoryChange(idx, e.target.value)}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>

            {!isOther && cfg.masterSlug ? (
              <label style={{ gridColumn: '1 / -1' }}>
                Match {cfg.label.toLowerCase()}
                <MasterItemSelect
                  masterSlug={cfg.masterSlug}
                  category={item.item_category}
                  value={item.master_record_id || item.raw_material_id}
                  label={item.master_record_label || item.raw_material_label}
                  onChange={(mapped) => onMasterSelect(idx, mapped)}
                />
              </label>
            ) : null}

            {isOther ? (
              <label style={{ gridColumn: '1 / -1' }}>
                Description <span style={{ color: '#b91c1c' }}>*</span>
                <input
                  type="text"
                  value={item.item_description}
                  onChange={(e) => onItemChange(idx, 'item_description', e.target.value)}
                />
              </label>
            ) : (
              <>
                <label style={{ gridColumn: '1 / -1' }}>
                  Linked item
                  <input
                    type="text"
                    value={item.master_record_label || item.raw_material_label || 'Not linked'}
                    disabled
                  />
                </label>

                {item.item_category === 'raw_material' ? (
                  <>
                    <label>
                      Grade
                      <input
                        type="text"
                        value={item.grade}
                        onChange={(e) => onItemChange(idx, 'grade', e.target.value)}
                        disabled={!item.master_record_id && !item.raw_material_id}
                      />
                    </label>

                    <label>
                      Inventory Number
                      <input
                        type="text"
                        value={item.inventory_number}
                        onChange={(e) => onItemChange(idx, 'inventory_number', e.target.value)}
                        disabled={!item.master_record_id && !item.raw_material_id}
                      />
                    </label>
                  </>
                ) : null}
              </>
            )}

            <label>
              Unit
              <input
                type="text"
                value={item.unit}
                onChange={(e) => onItemChange(idx, 'unit', e.target.value)}
                placeholder={cfg.quantityType === 'kg' ? 'kg' : 'nos'}
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

          {!isOther && !(item.master_record_id || item.raw_material_id) ? (
            <p className="muted" style={{ marginTop: 8, color: '#b91c1c' }}>
              Link an existing {cfg.label.toLowerCase()} from the master before registering this GIRN.
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
            <span>Amount: <strong>₹{fmt(item.amount)}</strong></span>
            <span>GST: <strong>₹{fmt(item.vat_amount)}</strong></span>
            <span>Total: <strong>₹{fmt(item.total_amount)}</strong></span>
          </div>
        </div>
        );
      })}

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

  function handleMasterSelect(idx, mapped) {
    setItems((prev) => {
      const next = [...prev];
      next[idx] = calcItem({
        ...next[idx],
        master_record_id: mapped.master_record_id,
        master_record_label: mapped.master_record_label,
        raw_material_id: mapped.raw_material_id,
        raw_material_label: mapped.raw_material_label,
        item_code: mapped.item_code || mapped.rm_id || next[idx].item_code,
        rm_id: mapped.rm_id || next[idx].rm_id,
        rm_code: mapped.rm_code || next[idx].rm_code,
        item_description: mapped.item_description || mapped.rm_code || next[idx].item_description,
        grade: mapped.grade || next[idx].grade,
        unit: mapped.unit || next[idx].unit,
        inventory_number: mapped.inventory_number || next[idx].inventory_number,
      });
      return next;
    });
  }

  function handleCategoryChange(idx, category) {
    const cfg = getCategoryConfig(category);
    setItems((prev) => {
      const next = [...prev];
      next[idx] = calcItem({
        ...EMPTY_ITEM,
        quantity: next[idx].quantity,
        unit_rate: next[idx].unit_rate,
        vat_percentage: next[idx].vat_percentage,
        item_category: category,
        quantity_type: cfg.quantityType,
      });
      return next;
    });
  }

  function handleItemChange(idx, field, value) {
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[idx], [field]: value };
      next[idx] = calcItem(item);
      return next;
    });
  }

  function itemIsValid(item) {
    if (toNumber(item.quantity) <= 0) return false;
    if (item.item_category === 'other') {
      return Boolean(String(item.item_description || '').trim());
    }
    return Boolean(item.master_record_id || item.raw_material_id);
  }

  const canRegister =
    (header.supplier_id || String(header.supplier_name || '').trim()) &&
    header.received_by &&
    header.received_date &&
    items.length > 0 &&
    items.every(itemIsValid);

  const allOilOrOther = items.length > 0 && items.every((item) => {
    const cat = item.item_category || 'raw_material';
    return cat === 'oil' || cat === 'other';
  });

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, itemIdx) => itemIdx !== idx));
  }

  async function registerGirn(submitForInspection = false) {
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        ...header,
        auto_approve: allOilOrOther && !submitForInspection,
        items: items.map((item) => ({
          item_category: item.item_category || 'raw_material',
          master_record_id: item.master_record_id || item.raw_material_id || null,
          quantity_type: item.quantity_type || getCategoryConfig(item.item_category).quantityType,
          item_code: item.item_code || item.rm_id || null,
          item_description: item.item_description || item.rm_code || null,
          raw_material_id: item.item_category === 'raw_material' ? (item.master_record_id || item.raw_material_id) : null,
          rm_id: item.rm_id || item.item_code || null,
          rm_code: item.rm_code || item.item_description || null,
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
      if (submitForInspection && !allOilOrOther) {
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
          {/* <p className="muted">Upload a scanned invoice, review OCR details, then register the GIRN.</p> */}
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
          <div style={{ display: 'flex', flexDirection: 'row', gap: 20 }}>
            <div className="card">
              <h2>1. Confirm receiver</h2>
              <p className="muted">The receiver is taken from the logged-in user. Change it only if needed.</p>
              <div style={{ marginTop: 12 }}>
                <p className="employee-detail-label">Received By</p>
                <strong className='employee-detail-value'>
                  {selectedEmployee
                    ? `${selectedEmployee.full_name}${selectedEmployee.employee_code ? ` (${selectedEmployee.employee_code})` : ''}`
                    : user?.name
                      ? `${user.name}${user.code ? ` (${user.code})` : ''}`
                      : 'Not selected'}
                </strong>
                {/* <div style={{ maxWidth: 360, marginTop: 12 }}>
                  <EmployeeSelect
                    value={header.received_by}
                    onChange={(employeeId) => setHeader((prev) => ({ ...prev, received_by: employeeId }))}
                    
                  />
                </div> */}
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
              onMasterSelect={handleMasterSelect}
              onCategoryChange={handleCategoryChange}
              onAddItem={addItem}
              onRemoveItem={removeItem}
            />

            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="neutral-button"
                onClick={() => setStep('scan')}
                disabled={submitting}
              >
                Upload different invoice
              </button>
              <button
                type="button"
                className="neutral-button"
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
