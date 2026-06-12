export default function InvoiceDetails({ invoice, onClose }) {
  if (!invoice) return null;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer-panel">
        <header className="drawer-header">
          <h2>Invoice Details</h2>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </header>

        <div className="drawer-body">
          {invoice.file_url ? (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <img src={invoice.file_url} alt="invoice" style={{ maxWidth: '100%', maxHeight: '400px' }} />
            </div>
          ) : null}

          <dl className="invoice-details">
            <dt>Vendor</dt>
            <dd>{invoice.vendor_name || '—'}</dd>

            <dt>Invoice #</dt>
            <dd>{invoice.invoice_number || '—'}</dd>

            <dt>Invoice Date</dt>
            <dd>{invoice.invoice_date || '—'}</dd>

            <dt>Due Date</dt>
            <dd>{invoice.due_date || '—'}</dd>

            <dt>Total</dt>
            <dd>{invoice.total_amount || '—'}</dd>

            <dt>Tax</dt>
            <dd>{invoice.tax_amount || '—'}</dd>

            <dt>Currency</dt>
            <dd>{invoice.currency || '—'}</dd>
          </dl>

          {invoice.line_items && invoice.line_items.length > 0 ? (
            <section>
              <h3>Line Items</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.line_items.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.description}</td>
                      <td>{it.quantity}</td>
                      <td>{it.unit_price}</td>
                      <td>{it.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      </aside>
    </>
  );
}
