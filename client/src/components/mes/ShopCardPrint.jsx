import { Printer } from 'lucide-react';

const LOGO_SRC = '/dascnclogo1.png';
const BLANK_LOT_ROWS = 6;

export function printShopCards() {
  document.body.classList.add('shop-card-printing');
  const cleanup = () => {
    document.body.classList.remove('shop-card-printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

export function ShopCardPrintDialog({ eyebrow, title, subtitle, onConfirmPrinted, children }) {
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
          <button type="button" className="mes-btn mes-btn-secondary" onClick={printShopCards}>
            <Printer size={16} />
            Print
          </button>
          <button type="button" className="mes-btn mes-btn-primary" onClick={onConfirmPrinted} autoFocus>
            Confirm printed
          </button>
        </div>
      </div>
    </div>
  );
}

function blankRows(count) {
  return Array.from({ length: count }, (_, index) => ({ key: `blank-${index}` }));
}

export function LotCardSheet({
  lotNumber,
  componentName,
  date,
  operator,
  operation,
  quantity,
}) {
  const rows = [
    {
      key: 'done',
      date: date || '',
      operator: operator || '',
      operation: operation || '',
      quantity: quantity ?? '',
    },
    ...blankRows(BLANK_LOT_ROWS),
  ];

  return (
    <article className="shop-card lot-card">
      <header className="shop-card-head">
        <img src={LOGO_SRC} alt="DasCNC" className="shop-card-logo" />
        <div className="shop-card-lotno">
          <span>Lot card</span>
          <strong>{lotNumber || '—'}</strong>
        </div>
      </header>

      <p className="shop-card-field">
        <span>Component</span>
        <strong>{componentName || '—'}</strong>
      </p>
      <p className="shop-card-field">
        <span>GIRN No.</span>
        <span className="shop-card-blank" />
      </p>
      <p className="shop-card-field">
        <span>Machine No.</span>
        <span className="shop-card-blank" />
      </p>

      <table className="shop-card-table">
        <thead>
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
              <td>{row.date || ''}</td>
              <td>{row.operator || ''}</td>
              <td>{row.operation || ''}</td>
              <td>{row.quantity === '' || row.quantity == null ? '' : row.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

export function GirnTagSheet({
  supplierName,
  materialName,
  girnNumber,
  receivedDate,
  quantity,
}) {
  const qtyLabel =
    quantity == null || quantity === ''
      ? '—'
      : Number(quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 });

  return (
    <article className="shop-card girn-tag">
      <header className="girn-tag-head">
        <img src={LOGO_SRC} alt="DasCNC" className="shop-card-logo" />
        <h1>Identification Tag</h1>
      </header>

      <p className="girn-tag-label">Description</p>
      <p className="girn-tag-value">{supplierName || '—'}</p>
      <p className="girn-tag-value girn-tag-material">{materialName || '—'}</p>

      <div className="girn-tag-grid">
        <div>
          <p className="girn-tag-label">GIRN No. & Date</p>
          <p className="girn-tag-value">
            {girnNumber || '—'}
            {receivedDate ? ` · ${receivedDate}` : ''}
          </p>
        </div>
        <div>
          <p className="girn-tag-label">Qty</p>
          <p className="girn-tag-value">{qtyLabel}</p>
        </div>
      </div>

      <div className="girn-approved-seal" aria-label="Approved">
        <span>Approved</span>
      </div>
    </article>
  );
}
