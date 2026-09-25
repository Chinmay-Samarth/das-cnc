import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link, useLocation } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../auth/authContext';
import { appAlert } from '../components/dialog';
import {
  AlertBanner,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '../components/mes';
import { Check, ClipboardList, FileText, Plus, Trash2 } from 'lucide-react';
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

function ReqMark() {
  return <span className="required-mark">*</span>;
}

function itemNeedsLink(item) {
  const cat = item.item_category || 'raw_material';
  if (cat === 'other') return false;
  return !(item.master_record_id || item.raw_material_id);
}

function itemIsReady(item) {
  if (toNumber(item.quantity) <= 0) return false;
  if (item.item_category === 'other') {
    return Boolean(String(item.item_description || '').trim());
  }
  return Boolean(item.master_record_id || item.raw_material_id);
}

function registerBlockers({ header, items }) {
  const blockers = [];
  if (!(header.supplier_id || String(header.supplier_name || '').trim())) {
    blockers.push('Supplier required');
  }
  if (!header.received_by) blockers.push('Receiver required');
  if (!header.received_date) blockers.push('Received date required');
  if (!items.length) blockers.push('Add at least one line');
  const unlinked = items.filter(itemNeedsLink).length;
  if (unlinked) blockers.push(`${unlinked} line${unlinked === 1 ? '' : 's'} need master link`);
  const badQty = items.filter((item) => toNumber(item.quantity) <= 0).length;
  if (badQty) blockers.push(`${badQty} line${badQty === 1 ? '' : 's'} need quantity`);
  const otherMissing = items.filter(
    (item) =>
      item.item_category === 'other' && !String(item.item_description || '').trim()
  ).length;
  if (otherMissing) blockers.push(`${otherMissing} Other line${otherMissing === 1 ? '' : 's'} need description`);
  return blockers;
}

function ReceivedByField({ employees, header, user, onReceivedByChange }) {
  const [overrideEmployee, setOverrideEmployee] = useState(false);
  const selectedEmployee = employees.find((e) => String(e.id) === String(header.received_by));
  const employeeLabel = selectedEmployee
    ? `${selectedEmployee.full_name}${selectedEmployee.employee_code ? ` (${selectedEmployee.employee_code})` : ''}`
    : user?.name
      ? `${user.name}${user.code ? ` (${user.code})` : ''}`
      : 'Select employee';

  return (
    <div className="girn-review-received">
      <span className="girn-review-field-label">Received by</span>
      {!overrideEmployee ? (
        <div className="girn-review-received-row">
          <StatusBadge status="completed">{employeeLabel}</StatusBadge>
          <button type="button" className="neutral-button" onClick={() => setOverrideEmployee(true)}>
            Change
          </button>
        </div>
      ) : (
        <EmployeeSelect value={header.received_by} onChange={onReceivedByChange} />
      )}
    </div>
  );
}

function ReceiptEssentials({
  header,
  employees,
  user,
  onChange,
  onReceivedByChange,
  showPo = true,
}) {
  const [moreOpen, setMoreOpen] = useState(Boolean(header.notes || header.csr));

  return (
    <section className="mes-card girn-review-card girn-review-essentials">
      <header className="girn-review-card-head">
        <div>
          <h3 className="form-page-section-title">Receipt</h3>
          <p className="girn-review-lead">Date and receiver — then register.</p>
        </div>
      </header>

      <div className="girn-review-essential-grid">
        <label>
          Received date <ReqMark />
          <input
            type="date"
            className="date-bar"
            name="received_date"
            value={header.received_date}
            onChange={onChange}
            required
          />
        </label>
        <ReceivedByField
          employees={employees}
          header={header}
          user={user}
          onReceivedByChange={onReceivedByChange}
        />
      </div>

      <button
        type="button"
        className="girn-review-more-toggle"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
      >
        {moreOpen ? 'Hide optional fields' : 'CSR, PO, notes'}
      </button>

      {moreOpen ? (
        <div className="form-page-grid girn-review-fields girn-review-optional">
          {showPo ? (
            <label>
              Linked purchase order
              {header.purchase_order_id ? (
                <Link
                  to={`/purchase-orders/${header.purchase_order_id}`}
                  className="neutral-button girn-review-po-link"
                >
                  <ClipboardList size={15} />
                  {header.po_reference || 'Open PO'}
                </Link>
              ) : (
                <input
                  type="text"
                  name="po_reference"
                  value={header.po_reference}
                  onChange={onChange}
                  placeholder="Optional"
                />
              )}
            </label>
          ) : null}
          <label>
            CSR
            <input type="text" name="csr" value={header.csr} onChange={onChange} />
          </label>
          <label className="form-span-2">
            Notes
            <textarea name="notes" value={header.notes} onChange={onChange} rows={2} />
          </label>
        </div>
      ) : null}
    </section>
  );
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
  const grandTotal = items.reduce((sum, item) => sum + toNumber(item.total_amount), 0);
  const supplierName = header.supplier_name || invoice?.suppliers?.name || '—';
  const readyCount = items.filter(itemIsReady).length;
  const allReady = items.length > 0 && readyCount === items.length;

  return (
    <div className="girn-review">
      <section className="mes-card girn-review-summary">
        <div className="girn-review-summary-main">
          <div>
            <p className="girn-review-summary-kicker">Ready to register</p>
            <h2 className="girn-review-summary-title">{supplierName}</h2>
            <p className="girn-review-summary-meta">
              Invoice <strong>{invoice?.invoice_number || '—'}</strong>
              {header.supplier_gstin ? ` · GSTIN ${header.supplier_gstin}` : ''}
            </p>
          </div>
          <div className="girn-review-summary-total">
            <span>Grand total</span>
            <strong>₹{fmt(grandTotal)}</strong>
          </div>
        </div>
        <div className="girn-review-summary-chips">
          <StatusBadge status="completed">OCR confirmed</StatusBadge>
          <StatusBadge status={allReady ? 'completed' : 'ready'}>
            {readyCount}/{items.length} lines ready
          </StatusBadge>
          {invoice?.file_url ? (
            <a
              href={invoice.file_url}
              target="_blank"
              rel="noreferrer"
              className="neutral-button girn-review-scan-link"
            >
              <FileText size={14} />
              View scan
            </a>
          ) : null}
        </div>
      </section>

      <ReceiptEssentials
        header={header}
        employees={employees}
        user={user}
        onChange={onChange}
        onReceivedByChange={onReceivedByChange}
      />

      <section className="mes-card girn-review-card">
        <header className="girn-review-card-head">
          <div>
            <h3 className="form-page-section-title">Lines</h3>
            <p className="girn-review-lead">Linked at OCR — glance and register.</p>
          </div>
          <StatusBadge status="draft">{items.length}</StatusBadge>
        </header>

        {items.length === 0 ? (
          <EmptyState title="No lines" description="No confirmed line items on this invoice." />
        ) : (
          <div className="girn-review-line-list" role="list">
            {items.map((item, idx) => {
              const cfg = getCategoryConfig(item.item_category || 'raw_material');
              const ready = itemIsReady(item);
              return (
                <div
                  key={idx}
                  className={`girn-review-line${ready ? ' is-ready' : ' is-blocked'}`}
                  role="listitem"
                >
                  <span className="girn-review-line-idx">{idx + 1}</span>
                  <div className="girn-review-line-body">
                    <p className="girn-review-line-title">
                      {item.item_description ||
                        item.master_record_label ||
                        item.rm_code ||
                        '—'}
                    </p>
                    <p className="girn-review-line-sub">
                      {cfg.label}
                      {item.master_record_label || item.raw_material_label
                        ? ` · ${item.master_record_label || item.raw_material_label}`
                        : ' · Not linked'}
                    </p>
                  </div>
                  <div className="girn-review-line-qty">
                    <span>{item.quantity || '—'} {item.unit || ''}</span>
                    <strong>₹{fmt(item.total_amount)}</strong>
                  </div>
                  <StatusBadge status={ready ? 'completed' : 'overdue'}>
                    {ready ? <><Check size={12} strokeWidth={3} /> OK</> : 'Fix'}
                  </StatusBadge>
                </div>
              );
            })}
            <div className="girn-review-line-footer">
              <span>Grand total</span>
              <strong>₹{fmt(grandTotal)}</strong>
            </div>
          </div>
        )}
      </section>
    </div>
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
  const [supplierOpen, setSupplierOpen] = useState(
    !header.supplier_id && !supplierLocked
  );

  return (
    <>
      <section className="mes-card girn-review-summary">
        <div className="girn-review-summary-main">
          <div>
            <p className="girn-review-summary-kicker">Supplier</p>
            <h2 className="girn-review-summary-title">
              {header.supplier_name || 'Set supplier'}
            </h2>
            <p className="girn-review-summary-meta">
              {header.supplier_gstin
                ? `GSTIN ${header.supplier_gstin}`
                : 'Confirm supplier before registering'}
            </p>
          </div>
          {!supplierLocked ? (
            <button
              type="button"
              className="neutral-button"
              onClick={() => setSupplierOpen((v) => !v)}
            >
              {supplierOpen ? 'Done' : 'Edit'}
            </button>
          ) : (
            <StatusBadge status="completed">Locked</StatusBadge>
          )}
        </div>

        {supplierOpen && !supplierLocked ? (
          <div className="form-page-grid girn-review-fields girn-review-optional">
            <label>
              Supplier name <ReqMark />
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
            <label className="form-span-2">
              Link existing supplier
              <select
                name="supplier_id"
                value={header.supplier_id}
                onChange={onSupplierSelect}
              >
                <option value="">Create from OCR details above</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </section>

      <ReceiptEssentials
        header={header}
        employees={employees}
        user={user}
        onChange={onChange}
        onReceivedByChange={onReceivedByChange}
      />
    </>
  );
}

function ItemsReview({ items, onItemChange, onMasterSelect, onCategoryChange, onAddItem, onRemoveItem }) {
  const grandTotal = items.reduce((sum, item) => sum + toNumber(item.total_amount), 0);
  const readyCount = items.filter(itemIsReady).length;
  const blocked = items.length - readyCount;
  const [expanded, setExpanded] = useState(() =>
    Object.fromEntries(items.map((item, idx) => [idx, !itemIsReady(item)]))
  );

  function toggleExpand(idx) {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  return (
    <section className="mes-card girn-review-card">
      <header className="girn-review-card-head">
        <div>
          <h3 className="form-page-section-title">Lines</h3>
          <p className="girn-review-lead">
            Link stocked lines · set qty · register.
          </p>
        </div>
        <div className="girn-review-card-head-actions">
          <StatusBadge status={blocked ? 'ready' : 'completed'}>
            {readyCount}/{items.length} ready
          </StatusBadge>
          <button type="button" className="neutral-button" onClick={onAddItem}>
            <Plus size={15} />
            Add
          </button>
        </div>
      </header>

      {blocked > 0 ? (
        <AlertBanner tone="amber">
          {blocked} line{blocked === 1 ? '' : 's'} still need a link, description, or quantity.
        </AlertBanner>
      ) : null}

      <div className="girn-review-items">
        {items.map((item, idx) => {
          const cfg = getCategoryConfig(item.item_category || 'raw_material');
          const isOther = item.item_category === 'other';
          const linked = Boolean(item.master_record_id || item.raw_material_id);
          const ready = itemIsReady(item);
          const open = expanded[idx] ?? !ready;

          return (
            <article
              key={idx}
              className={`girn-review-item${ready ? ' is-ready' : ' is-blocked'}${open ? ' is-open' : ''}`}
            >
              <button
                type="button"
                className="girn-review-item-summary"
                onClick={() => toggleExpand(idx)}
                aria-expanded={open}
              >
                <span className="girn-review-line-idx">{idx + 1}</span>
                <div className="girn-review-line-body">
                  <p className="girn-review-line-title">
                    {item.item_description ||
                      item.master_record_label ||
                      item.raw_material_label ||
                      item.rm_code ||
                      `Item ${idx + 1}`}
                  </p>
                  <p className="girn-review-line-sub">
                    {cfg.label}
                    {' · '}
                    {item.quantity || '—'} {item.unit || cfg.quantityType}
                    {' · '}
                    ₹{fmt(item.total_amount)}
                  </p>
                </div>
                <StatusBadge status={ready ? 'completed' : 'overdue'}>
                  {ready ? 'OK' : 'Needs fix'}
                </StatusBadge>
              </button>

              {open ? (
                <div className="girn-review-item-edit">
                  <div className="girn-review-item-edit-top">
                    <label>
                      Category
                      <select
                        value={item.item_category || 'raw_material'}
                        onChange={(e) => onCategoryChange(idx, e.target.value)}
                      >
                        {CATEGORY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {items.length > 1 ? (
                      <button
                        type="button"
                        className="neutral-button"
                        onClick={() => onRemoveItem(idx)}
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    ) : null}
                  </div>

                  {!isOther && cfg.masterSlug ? (
                    <label className="girn-review-match">
                      Match {cfg.label.toLowerCase()} <ReqMark />
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
                    <label className="girn-review-match">
                      Description <ReqMark />
                      <input
                        type="text"
                        value={item.item_description}
                        onChange={(e) => onItemChange(idx, 'item_description', e.target.value)}
                        autoFocus={!item.item_description}
                      />
                    </label>
                  ) : null}

                  <div className="girn-review-qty-row">
                    <label>
                      Qty <ReqMark />
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={item.quantity}
                        onChange={(e) => onItemChange(idx, 'quantity', e.target.value)}
                      />
                    </label>
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
                      Rate
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

                  {!isOther && item.item_category === 'raw_material' && linked ? (
                    <div className="girn-review-qty-row">
                      <label>
                        Grade
                        <input
                          type="text"
                          value={item.grade}
                          onChange={(e) => onItemChange(idx, 'grade', e.target.value)}
                        />
                      </label>
                      <label>
                        Inventory #
                        <input
                          type="text"
                          value={item.inventory_number}
                          onChange={(e) => onItemChange(idx, 'inventory_number', e.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}

                  {!isOther && !linked ? (
                    <p className="girn-review-inline-warn">
                      Link a master record to continue.
                    </p>
                  ) : null}

                  <div className="girn-review-item-totals">
                    <span>
                      Amount <strong>₹{fmt(item.amount)}</strong>
                    </span>
                    <span>
                      GST <strong>₹{fmt(item.vat_amount)}</strong>
                    </span>
                    <span>
                      Total <strong>₹{fmt(item.total_amount)}</strong>
                    </span>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="girn-review-line-footer">
        <span>{items.length} line{items.length === 1 ? '' : 's'}</span>
        <strong>₹{fmt(grandTotal)}</strong>
      </div>
    </section>
  );
}

function ReviewActions({
  canRegister,
  submitting,
  blockers,
  isOutsourceReturn,
  invoiceReviewConfirmed,
  onBack,
  onCancel,
  onRegister,
  onRegisterAndSubmit,
}) {
  return (
    <div className="girn-review-sticky-actions">
      {blockers.length ? (
        <p className="girn-review-blocker-hint">{blockers[0]}</p>
      ) : (
        <p className="girn-review-ready-hint">
          <Check size={14} strokeWidth={3} />
          Ready — register now
        </p>
      )}
      <div className="girn-review-actions">
        <button
          type="button"
          className="neutral-button"
          onClick={onBack}
          disabled={submitting || invoiceReviewConfirmed}
        >
          Back
        </button>
        <div className="girn-review-actions-end">
          <button
            type="button"
            className="cancel-button"
            disabled={submitting}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="neutral-button"
            disabled={!canRegister || submitting}
            onClick={() => onRegister(false)}
          >
            {submitting ? 'Registering…' : 'Register only'}
          </button>
          {!isOutsourceReturn ? (
            <button
              type="button"
              className="primary-button"
              disabled={!canRegister || submitting}
              onClick={() => onRegisterAndSubmit(true)}
            >
              {submitting ? 'Submitting…' : 'Register & submit'}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={!canRegister || submitting}
              onClick={() => onRegister(false)}
            >
              {submitting ? 'Registering…' : 'Register GIRN'}
            </button>
          )}
        </div>
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
  const initials = selectedEmployee?.full_name?.split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

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
    return itemIsReady(item);
  }

  const canRegister =
    (header.supplier_id || String(header.supplier_name || '').trim()) &&
    header.received_by &&
    header.received_date &&
    items.length > 0 &&
    items.every(itemIsValid);

  const blockers = useMemo(
    () => registerBlockers({ header, items }),
    [header, items]
  );

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
        subtitle={null}
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
        <section className="card bpo-setup-card">
          <div className="bpo-panel">
            <h2>Scan supplier invoice</h2>
            <p className="muted bpo-lead">Upload Invoice to register GIRN</p>

            <div className="bpo-grid-2">
              <div>
                <p className="component-detail-label">Received by</p>
                <p className="bpo-step is-active">
                  <div className="sidebar-avatar">{initials}</div>
                  {selectedEmployee
                    ? `${selectedEmployee.full_name}${selectedEmployee.employee_code ? ` (${selectedEmployee.employee_code})` : ''}`
                    : user?.name
                      ? `${user.name}${user.code ? ` (${user.code})` : ''}`
                      : 'Not selected'}
                </p>
              </div>

              <div>
                <h3 className="girn-review-upload-title">Upload scanned invoice</h3>
                <GIRNInvoiceUpload
                  disabled={!header.received_by}
                  reviewReturnPath={reviewReturnPath}
                />
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="girn-review-step">
          {invoice && !invoiceReviewConfirmed ? (
            <section className="mes-card girn-review-card">
              <header className="girn-review-card-head">
                <div>
                  <h3 className="form-page-section-title">Invoice added</h3>
                  <p className="girn-review-lead">
                    Invoice {invoice.invoice_number || invoice.id} is in Purchase Invoices.
                  </p>
                </div>
                {invoice.file_url ? (
                  <a
                    href={invoice.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="neutral-button"
                  >
                    <FileText size={15} />
                    View scan
                  </a>
                ) : null}
              </header>
            </section>
          ) : null}

          {invoiceReviewConfirmed ? (
            <GirnRegisterPanel
              invoice={invoice}
              header={header}
              items={items}
              employees={employees}
              user={user}
              onChange={handleHeaderChange}
              onReceivedByChange={(employeeId) =>
                setHeader((prev) => ({ ...prev, received_by: employeeId }))
              }
            />
          ) : (
            <div className="girn-review">
              <HeaderReview
                header={header}
                suppliers={suppliers}
                employees={employees}
                user={user}
                onChange={handleHeaderChange}
                onSupplierSelect={handleSupplierSelect}
                supplierLocked={supplierLocked}
                onReceivedByChange={(employeeId) =>
                  setHeader((prev) => ({ ...prev, received_by: employeeId }))
                }
              />
              <ItemsReview
                items={items}
                onItemChange={handleItemChange}
                onMasterSelect={handleMasterSelect}
                onCategoryChange={handleCategoryChange}
                onAddItem={addItem}
                onRemoveItem={removeItem}
              />
            </div>
          )}

          <ReviewActions
            canRegister={canRegister}
            submitting={submitting}
            blockers={blockers}
            isOutsourceReturn={isOutsourceReturn}
            invoiceReviewConfirmed={invoiceReviewConfirmed}
            onBack={() => setStep(1)}
            onCancel={() => navigate(isOutsourceReturn ? '/production/outsource' : '/girn')}
            onRegister={registerGirn}
            onRegisterAndSubmit={registerGirn}
          />
        </div>
      )}
    </main>
  );
}
