import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import { appAlert } from '../components/dialog';
import { AlertBanner, PageHeader } from '../components/mes';
import { ArrowLeft, Check } from 'lucide-react';
import EmployeeSelect from './EmployeeSelect';
import GIRNInvoiceUpload from './GIRNInvoiceUpload';
import MasterItemSelect from './MasterItemSelect';
import { CATEGORY_OPTIONS, getCategoryConfig } from './girnCategoryConfig';

const STEPS = [
  { id: 1, title: 'Scan invoice', hint: 'Confirm receiver and upload' },
  { id: 2, title: 'Review & register', hint: 'Correct fields, link items, save' },
];

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
  purchase_order_line_id: null,
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

function GirnRegisterPanel({
  invoice,
  header,
  items,
  employees,
  user,
  onChange,
  onReceivedByChange,
}) {
  const [overrideEmployee, setOverrideEmployee] = useState(false);
  const selectedEmployee = employees.find((e) => String(e.id) === String(header.received_by));
  const employeeLabel = selectedEmployee
    ? `${selectedEmployee.full_name}${selectedEmployee.employee_code ? ` (${selectedEmployee.employee_code})` : ''}`
    : user?.name
      ? `${user.name}${user.code ? ` (${user.code})` : ''}`
      : 'Select employee';
  const grandTotal = items.reduce((sum, item) => sum + toNumber(item.total_amount), 0);

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header" style={{ marginBottom: 16 }}>
          <div>
            <h2>Register GIRN</h2>
            <p className="muted">Invoice OCR review is complete. Confirm receipt details and register.</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
          <div>
            <p className="component-detail-label">Supplier</p>
            <strong>{header.supplier_name || invoice?.suppliers?.name || '—'}</strong>
          </div>
          <div>
            <p className="component-detail-label">Invoice</p>
            <strong>{invoice?.invoice_number || invoice?.id || '—'}</strong>
          </div>
          <div>
            <p className="component-detail-label">GSTIN</p>
            <strong>{header.supplier_gstin || '—'}</strong>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          <label>
            Linked purchase order
            {header.purchase_order_id ? (
              <div>
                <Link to={`/purchase-orders/${header.purchase_order_id}`} className="neutral-button" style={{ display: 'inline-flex', width: 'fit-content' }}>
                  {header.po_reference || 'Open PO'}
                </Link>
              </div>
            ) : (
              <input
                type="text"
                name="po_reference"
                value={header.po_reference}
                onChange={onChange}
                placeholder="Optional text reference"
              />
            )}
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
                className="neutral-button"
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

      <div className="card">
        <div className="section-header" style={{ marginBottom: 16 }}>
          <div>
            <h2>Confirmed line items</h2>
            <p className="muted">Linked during invoice OCR review. Edit on the invoice if corrections are needed.</p>
          </div>
        </div>

        <div className="app-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Category</th>
                <th>Master</th>
                <th>Qty</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td>{item.item_description || item.master_record_label || item.rm_code || '—'}</td>
                  <td>{getCategoryConfig(item.item_category || 'raw_material').label}</td>
                  <td>{item.master_record_label || item.raw_material_label || '—'}</td>
                  <td>{item.quantity || '—'}</td>
                  <td>₹{fmt(item.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <strong>Grand Total: ₹{fmt(grandTotal)}</strong>
        </div>
      </div>
    </>
  );
}

function HeaderReview({
  header,
  suppliers,
  employees,
  user,
  onChange,
  onReceivedByChange,
  onSupplierSelect,
  supplierLocked = false,
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
            disabled={supplierLocked || Boolean(header.supplier_id)}
          />
        </label>

        <label>
          GSTIN
          <input
            type="text"
            name="supplier_gstin"
            value={header.supplier_gstin || ''}
            onChange={onChange}
            disabled={supplierLocked || Boolean(header.supplier_id)}
          />
        </label>

        <label>
          Link existing supplier
          <select
            name="supplier_id"
            value={header.supplier_id}
            onChange={onSupplierSelect}
            disabled={supplierLocked}
          >
            <option value="">Create from OCR details above</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </label>

        <label>
          Linked purchase order
          {header.purchase_order_id ? (
            <div>
              <Link to={`/purchase-orders/${header.purchase_order_id}`} className="neutral-button" style={{ display: 'inline-flex', width: 'fit-content' }}>
                {header.po_reference || 'Open PO'}
              </Link>
            </div>
          ) : (
            <input
              type="text"
              name="po_reference"
              value={header.po_reference}
              onChange={onChange}
              placeholder="Optional text reference"
            />
          )}
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
              className="neutral-button"
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
        <button type="button" className="neutral-button" onClick={onAddItem}>
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
                className="neutral-button"
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const outsourceShipmentId = searchParams.get('outsource_shipment_id') || '';
  const querySupplierId = searchParams.get('supplier_id') || '';
  const queryPoReference = searchParams.get('po_reference') || '';
  const purchaseOrderId = searchParams.get('purchase_order_id') || '';
  const invoiceIdFromQuery = searchParams.get('invoice_id') || '';
  const reviewedFlag = searchParams.get('reviewed') || '';
  const isOutsourceReturn = Boolean(outsourceShipmentId);

  const [suppliers, setSuppliers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [invoiceReviewConfirmed, setInvoiceReviewConfirmed] = useState(false);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [outsourceShipment, setOutsourceShipment] = useState(null);
  const [supplierLocked, setSupplierLocked] = useState(false);
  const [header, setHeader] = useState({
    invoice_id: '',
    supplier_id: querySupplierId || '',
    supplier_name: '',
    supplier_gstin: '',
    po_reference: queryPoReference || '',
    received_date: new Date().toISOString().slice(0, 10),
    received_by: '',
    csr: '',
    notes: '',
    outsource_shipment_id: outsourceShipmentId || '',
    purchase_order_id: purchaseOrderId || '',
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const reviewLoadedRef = useRef(false);

  const reviewReturnPath = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.delete('invoice_id');
    params.delete('reviewed');
    const qs = params.toString();
    return qs ? `/girn/create?${qs}` : '/girn/create';
  }, [searchParams]);

  function applyReviewConfirmed(invoiceData, draftGirn = {}) {
    setInvoice(invoiceData);
    setInvoiceReviewConfirmed(true);
    setSupplierLocked(Boolean(draftGirn.supplier_id || invoiceData?.supplier_id));
    setHeader((prev) => ({
      ...prev,
      invoice_id: draftGirn.invoice_id || invoiceData?.id || prev.invoice_id,
      supplier_id: draftGirn.supplier_id || invoiceData?.supplier_id || prev.supplier_id,
      supplier_name: draftGirn.supplier_name || invoiceData?.suppliers?.name || prev.supplier_name,
      supplier_gstin: draftGirn.supplier_gstin || prev.supplier_gstin,
      po_reference: prev.po_reference || draftGirn.po_reference || '',
      received_date: draftGirn.received_date || prev.received_date,
      received_by: user?.id || draftGirn.received_by || prev.received_by,
      csr: draftGirn.csr || prev.csr,
      notes: draftGirn.notes || prev.notes,
      outsource_shipment_id: prev.outsource_shipment_id || outsourceShipmentId || '',
      purchase_order_id: prev.purchase_order_id || purchaseOrderId || '',
    }));
    if (draftGirn.items?.length) {
      setItems(normalizeDraftItems(draftGirn.items));
    } else if (invoiceData?.line_items?.length) {
      setItems(normalizeDraftItems(invoiceData.line_items.map((line) => ({
        item_category: line.item_category || 'raw_material',
        master_record_id: line.master_record_id,
        master_record_label: line.master_record_label,
        item_description: line.scanned_description || line.description,
        quantity: line.quantity,
        unit_rate: line.unit_price,
        total_amount: line.total,
      }))));
    }
    setStep(2);
  }

  useEffect(() => {
    if (reviewLoadedRef.current) return;

    const state = location.state;
    if (state?.invoice && (state.invoice.review_status === 'confirmed' || reviewedFlag === '1')) {
      reviewLoadedRef.current = true;
      applyReviewConfirmed(state.invoice, state.draft_girn || {});
      return;
    }

    if (!invoiceIdFromQuery || reviewedFlag !== '1' || state?.invoice) return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/invoices/${invoiceIdFromQuery}`);
        if (cancelled || !data.invoice) return;
        if (data.invoice.review_status !== 'confirmed' && data.invoice.status === 'needs_review') {
          navigate(`/invoices/${invoiceIdFromQuery}/review?context=girn&return=${encodeURIComponent(reviewReturnPath)}`);
          return;
        }
        reviewLoadedRef.current = true;
        applyReviewConfirmed(data.invoice, {});
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Unable to load confirmed invoice.');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [location.state, invoiceIdFromQuery, reviewedFlag, navigate, reviewReturnPath]);

  useEffect(() => {
    api.get('/suppliers').then(({ data }) => setSuppliers(data.suppliers || []));
    api.get('/employees').then(({ data }) => setEmployees(data.employees || []));
  }, []);

  useEffect(() => {
    if (!purchaseOrderId || isOutsourceReturn) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/purchase-orders/${purchaseOrderId}/girn-draft`);
        const draft = data.draft;
        if (cancelled || !draft) return;
        setSupplierLocked(true);
        setHeader((prev) => ({
          ...prev,
          purchase_order_id: draft.purchase_order_id,
          supplier_id: draft.supplier_id || prev.supplier_id,
          supplier_name: draft.supplier_name || prev.supplier_name,
          supplier_gstin: draft.supplier_gstin || prev.supplier_gstin,
          po_reference: draft.po_reference || prev.po_reference,
          received_date: draft.received_date || prev.received_date,
        }));
        if (draft.items?.length) {
          setItems(normalizeDraftItems(draft.items));
        }
        setStep(2);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Unable to load PO for GIRN.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [purchaseOrderId, isOutsourceReturn]);

  useEffect(() => {
    if (!outsourceShipmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/production/outsource/shipments/${outsourceShipmentId}`);
        const shipment = data.shipment;
        if (cancelled || !shipment) return;
        setOutsourceShipment(shipment);
        setSupplierLocked(!!shipment.supplier_id);
        setHeader((prev) => ({
          ...prev,
          outsource_shipment_id: shipment.id,
          supplier_id: shipment.supplier_id || prev.supplier_id || querySupplierId,
          supplier_name: shipment.supplier_name || prev.supplier_name,
          po_reference: shipment.shipment_number || queryPoReference || prev.po_reference,
        }));
        if (shipment.master_record_id || shipment.sent_qty_total) {
          setItems([
            calcItem({
              ...EMPTY_ITEM,
              item_category: 'component',
              quantity_type: 'number',
              master_record_id: shipment.master_record_id || null,
              master_record_label: shipment.component_label || '',
              item_description: shipment.component_label || '',
              quantity: String(shipment.sent_qty_total || ''),
            }),
          ]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Unable to load outsource shipment.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outsourceShipmentId, querySupplierId, queryPoReference]);

  useEffect(() => {
    if (user?.id && !header.received_by) {
      setHeader((prev) => ({ ...prev, received_by: user.id }));
    }
  }, [user, header.received_by]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => String(employee.id) === String(header.received_by)),
    [employees, header.received_by]
  );

  function handleHeaderChange(event) {
    const { name, value } = event.target;
    setHeader((prev) => ({ ...prev, [name]: value }));
  }

  function handleSupplierSelect(event) {
    if (supplierLocked) return;
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
        purchase_order_id: header.purchase_order_id || purchaseOrderId || null,
        outsource_shipment_id: header.outsource_shipment_id || outsourceShipmentId || null,
        auto_approve: allOilOrOther && !submitForInspection && !isOutsourceReturn,
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
          purchase_order_line_id: item.purchase_order_line_id || null,
        })),
      };

      const { data } = await api.post('/girn', payload);
      const newId = data.girn.id;
      if (submitForInspection && !allOilOrOther && !isOutsourceReturn) {
        await api.post(`/girn/${newId}/submit`);
      }
      if (isOutsourceReturn) {
        await appAlert({
          title: 'Shipment received',
          message:
            data.message ||
            'GIRN registered. Outsource lots have been received and will continue routing.',
          tone: 'success',
        });
        navigate('/production/outsource');
        return;
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
    <main className="mes-shell bpo-setup-page girn-setup-page">
      <PageHeader
        eyebrow={isOutsourceReturn ? 'Outsourcing return' : 'Procurement'}
        title={isOutsourceReturn ? 'GIRN — outsource inward' : 'New GIRN'}
        subtitle={
          isOutsourceReturn
            ? `Upload the supplier invoice for shipment ${outsourceShipment?.shipment_number || header.po_reference || 'OS'}. Registering this GIRN receives the lots and resumes routing.`
            : 'Scan the invoice, review details, then register.'
        }
        actions={
          <button type="button" className="neutral-button" onClick={() => navigate(isOutsourceReturn ? '/production/outsource' : '/girn')}>
            <ArrowLeft size={16} />
            {isOutsourceReturn ? 'Outsource' : 'All GIRNs'}
          </button>
        }
      />

      <nav className="bpo-steps" aria-label="GIRN setup steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`bpo-step${step === s.id ? ' is-active' : ''}${step > s.id ? ' is-done' : ''}`}
            onClick={() => {
              if (s.id < step) setStep(s.id);
            }}
            disabled={s.id > step || submitting}
          >
            <span className="bpo-step-num">
              {step > s.id ? <Check size={14} strokeWidth={3} /> : s.id}
            </span>
            <span className="bpo-step-text">
              <strong>{s.title}</strong>
              <small>{s.hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <section className="card bpo-setup-card">
        {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
        {header.purchase_order_id ? (
          <AlertBanner tone="amber">
            Receiving against{' '}
            <Link to={`/purchase-orders/${header.purchase_order_id}`}>
              {header.po_reference || 'purchase order'}
            </Link>
            . Lines stay linked so receipts roll up on the PO.
          </AlertBanner>
        ) : null}

        {step === 1 ? (
          <div className="bpo-panel">
            <h2>Scan supplier invoice</h2>
            <p className="muted bpo-lead">
              Confirm who is receiving the goods, then upload the invoice for OCR extraction.
            </p>

            <div className="bpo-grid-2">
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Confirm receiver</h3>
                <p className="muted" style={{ margin: '0 0 12px' }}>
                  Taken from the logged-in user. Change only if needed.
                </p>
                <p className="component-detail-label">Received by</p>
                <strong>
                  {selectedEmployee
                    ? `${selectedEmployee.full_name}${selectedEmployee.employee_code ? ` (${selectedEmployee.employee_code})` : ''}`
                    : user?.name
                      ? `${user.name}${user.code ? ` (${user.code})` : ''}`
                      : 'Not selected'}
                </strong>
              </div>

              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Upload scanned invoice</h3>
                <p className="muted" style={{ margin: '0 0 12px' }}>
                  OCR extracts supplier, invoice, and line item details for review.
                </p>
                <GIRNInvoiceUpload
                  disabled={!header.received_by}
                  reviewReturnPath={reviewReturnPath}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            {invoice && !invoiceReviewConfirmed ? (
              <div className="bpo-panel" style={{ marginBottom: 16 }}>
                <h2>Invoice added</h2>
                <p className="muted bpo-lead">
                  Invoice {invoice.invoice_number || invoice.id} has been added to the Invoices tab.
                </p>
                {invoice.file_url ? (
                  <a href={invoice.file_url} target="_blank" rel="noreferrer" className="neutral-button" style={{ display: 'inline-flex' }}>
                    View scanned invoice
                  </a>
                ) : null}
              </div>
            ) : null}

            {invoiceReviewConfirmed ? (
              <GirnRegisterPanel
                invoice={invoice}
                header={header}
                items={items}
                employees={employees}
                user={user}
                onChange={handleHeaderChange}
                onReceivedByChange={(employeeId) => setHeader((prev) => ({ ...prev, received_by: employeeId }))}
              />
            ) : (
              <>
                <HeaderReview
                  header={header}
                  suppliers={suppliers}
                  employees={employees}
                  user={user}
                  onChange={handleHeaderChange}
                  onSupplierSelect={handleSupplierSelect}
                  supplierLocked={supplierLocked}
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
              </>
            )}

            <div className="bpo-footer">
              <button
                type="button"
                className="neutral-button"
                onClick={() => setStep(1)}
                disabled={submitting || invoiceReviewConfirmed}
              >
                Back
              </button>

              <div className="bpo-actions-row">
                <button
                  type="button"
                  className="cancel-button"
                  disabled={submitting}
                  onClick={() => navigate(isOutsourceReturn ? '/production/outsource' : '/girn')}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={!canRegister || submitting}
                  onClick={() => registerGirn(false)}
                >
                  {submitting ? 'Registering…' : 'Register GIRN'}
                </button>
                {!isOutsourceReturn ? (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!canRegister || submitting}
                    onClick={() => registerGirn(true)}
                  >
                    {submitting ? 'Submitting…' : 'Register & submit for inspection'}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
