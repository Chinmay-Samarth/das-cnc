import { Printer } from 'lucide-react';

const LOGO_SRC = '/dascnclogo2.png';
export const LOT_CARD_ROWS = 7;

export function printShopCards() {
  // Clone cards onto body so the rest of the app cannot create blank print pages.
  const dialogRoot = document.querySelector('.shop-card-dialog .shop-card-print-root');
  const roots = dialogRoot
    ? [dialogRoot]
    : Array.from(document.querySelectorAll('.shop-card-print-root'));
  const cards = roots.flatMap((root) => Array.from(root.querySelectorAll(':scope > .shop-card')));

  const host = document.createElement('div');
  host.className = 'shop-card-print-host';
  cards.forEach((card) => host.appendChild(card.cloneNode(true)));
  document.body.appendChild(host);
  document.body.classList.add('shop-card-printing');

  const cleanup = () => {
    document.body.classList.remove('shop-card-printing');
    host.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

export function ShopCardPrintDialog({
  eyebrow,
  title,
  subtitle,
  onConfirmPrinted,
  allowPrint = true,
  children,
}) {
  return (
    <div className="pc-modal-backdrop shop-card-dialog-backdrop" role="presentation">
      <div
        className="pc-modal shop-card-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-card-print-title"
      >
        <p className="lot-receipt-eyebrow">{eyebrow}</p>
        <h2 id="shop-card-print-title">{title}</h2>
        {subtitle ? (
          <p className="muted" style={{ margin: '0 0 14px' }}>
            {subtitle}
          </p>
        ) : null}
        <div className="shop-card-preview">{children}</div>
        <div className="shop-card-print-root" aria-hidden="true">
          {children}
        </div>
        <div className="pc-modal-actions" style={{ marginTop: 16 }}>
          {allowPrint ? (
            <button type="button" className="mes-btn mes-btn-secondary" onClick={printShopCards}>
              <Printer size={16} />
              Print
            </button>
          ) : null}
          <button type="button" className="mes-btn mes-btn-primary" onClick={onConfirmPrinted} autoFocus>
            {allowPrint ? 'Confirm printed' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LotCardSheet({
  lotNumber,
  componentName,
  girnNumber,
  machineNumber,
  date,
  operator,
  operation,
  quantity,
  operations = [],
  onlyRowIndex = null,
}) {
  const lineOnly = onlyRowIndex != null && onlyRowIndex !== '';
  const inkIndex = lineOnly ? Number(onlyRowIndex) : 0;
  const opLabels = Array.from({ length: LOT_CARD_ROWS }, (_, index) => {
    const fromList = Array.isArray(operations) ? String(operations[index] || '').trim() : '';
    if (fromList) return fromList;
    // Fallback when AF list is missing: keep first-row operation name.
    if (!lineOnly && index === 0) return String(operation || '').trim();
    return '';
  });

  const rows = Array.from({ length: LOT_CARD_ROWS }, (_, index) => {
    const fillMetrics = lineOnly ? index === inkIndex : index === 0;
    return {
      key: `row-${index}`,
      inkMetrics: lineOnly && fillMetrics,
      date: fillMetrics ? date || '' : '',
      operator: fillMetrics ? operator || '' : '',
      operation: opLabels[index],
      quantity: fillMetrics ? (quantity ?? '') : '',
    };
  });

  return (
    <article className={`shop-card lot-card${lineOnly ? ' lot-card-line-only' : ''}`}>
      <header className="lot-card-head lot-card-guide">
        <img src={LOGO_SRC} alt="DasCNC" className="shop-card-logo" />
        <div className="shop-card-lotno">
          <strong>{lotNumber || '—'}</strong>
        </div>
        <div className="lot-card-ids">
          <p className="shop-card-field">
            <span>Component No.</span>
            {componentName ? <strong>{componentName}</strong> : <span className="shop-card-blank" />}
          </p>
          <p className="shop-card-field">
            <span>GIRN No.</span>
            {girnNumber ? <strong>{girnNumber}</strong> : <span className="shop-card-blank" />}
          </p>
          <p className="shop-card-field">
            <span>Machine No.</span>
            {machineNumber ? <strong>{machineNumber}</strong> : <span className="shop-card-blank" />}
          </p>
        </div>
      </header>

      <table className="shop-card-table">
        <thead className="lot-card-guide">
          <tr>
            <th>Date</th>
            <th>Operator</th>
            <th>Operation</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className={row.inkMetrics ? 'lot-card-line-ink' : 'lot-card-guide'}>
                {row.date || ''}
              </td>
              <td className={row.inkMetrics ? 'lot-card-line-ink' : 'lot-card-guide'}>
                {row.operator || ''}
              </td>
              {/* Operation names are pre-printed from the AF path; never re-inked on later lines. */}
              <td className="lot-card-guide">{row.operation || ''}</td>
              <td className={row.inkMetrics ? 'lot-card-line-ink' : 'lot-card-guide'}>
                {row.quantity === '' || row.quantity == null ? '' : row.quantity}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function formatQty(value) {
  if (value == null || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return amount.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function GirnTagSheet({
  supplierName,
  materialName,
  girnNumber,
  receivedDate,
  quantity,
  quantityKg,
  quantityNos,
  status = 'approved',
  approvedBy,
  rejectedBy,
}) {
  const rejected = status === 'rejected';
  const actor = rejected ? rejectedBy || approvedBy : approvedBy || rejectedBy;
  const kgs = formatQty(quantityKg);
  const nos = formatQty(quantityNos != null && quantityNos !== '' ? quantityNos : quantityKg == null ? quantity : '');

  return (
    <article className="shop-card girn-tag">
      <header className="girn-tag-head">
        <img src={LOGO_SRC} alt="DasCNC" className="shop-card-logo" />
        <h1>Identification Tag</h1>
      </header>

      <div className="girn-tag-stack">
        <div>
          <p className="girn-tag-label">Description</p>
          <p className="girn-tag-value">{supplierName || '—'}</p>
          <p className="girn-tag-value girn-tag-material">{materialName || '—'}</p>
        </div>
        <div>
          <p className="girn-tag-label">GIRN No. & Date</p>
          <p className="girn-tag-value">
            {girnNumber || '—'}
            {receivedDate ? ` · ${receivedDate}` : ''}
          </p>
        </div>
        <div>
          <p className="girn-tag-label">Qty</p>
          <p className="girn-tag-qty">
            <span>Kgs</span>
            {kgs ? <strong>{kgs}</strong> : <span className="shop-card-blank" />}
          </p>
          <p className="girn-tag-qty">
            <span>Nos</span>
            {nos ? <strong>{nos}</strong> : <span className="shop-card-blank" />}
          </p>
        </div>
        <p className="girn-tag-actor">
          <span>{rejected ? 'Rejected by' : 'Approved by'}</span>
          <strong>{actor || '—'}</strong>
        </p>
      </div>

      <div
        className={rejected ? 'girn-rejected-seal' : 'girn-approved-seal'}
        aria-label={rejected ? 'Rejected' : 'Approved'}
      >
        <span>{rejected ? 'Rejected' : 'Approved'}</span>
      </div>
    </article>
  );
}
