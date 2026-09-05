import { Plus, Trash2 } from 'lucide-react';

const TAX_KINDS = ['CGST', 'SGST', 'IGST', 'UTGST'];

function toPercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 0 && n <= 1 ? +(n * 100).toFixed(4) : n;
}

function recalcTax(tax) {
  const ratePct = Number(tax.rate);
  const base = Number(tax.base);
  let amount = Number(tax.amount);
  if (Number.isFinite(base) && base > 0 && Number.isFinite(ratePct) && ratePct > 0) {
    amount = Math.round(base * (ratePct / 100) * 100) / 100;
  }
  return {
    ...tax,
    kind: String(tax.kind || 'CGST').toUpperCase(),
    rate: Number.isFinite(ratePct) ? ratePct : '',
    base: Number.isFinite(base) ? base : tax.base ?? '',
    amount: Number.isFinite(amount) ? amount : tax.amount ?? '',
  };
}

export function normalizeTaxRows(taxItems = [], baseAmount) {
  const rows = Array.isArray(taxItems) ? taxItems : [];
  if (!rows.length) return [];
  return rows.map((t) =>
    recalcTax({
      kind: t.kind || 'CGST',
      rate: toPercent(t.rate),
      base: t.base ?? baseAmount ?? '',
      amount: t.amount ?? '',
    })
  );
}

export default function InvoiceRecheckTaxTable({ taxes, onChange, onRemove, onAdd }) {
  const totalTax = taxes.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  return (
    <div className="invoice-recheck-lines invoice-recheck-taxes">
      <table className="app-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Rate %</th>
            <th>Taxable base</th>
            <th>Tax amount</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {taxes.length === 0 ? (
            <tr>
              <td colSpan={5} className="invoice-recheck-empty">
                No tax lines. Add CGST/SGST or IGST if this invoice has GST.
              </td>
            </tr>
          ) : null}
          {taxes.map((tax, idx) => (
            <tr key={idx}>
              <td>
                <select
                  className="invoice-recheck-select"
                  value={tax.kind || 'CGST'}
                  onChange={(e) => onChange(idx, 'kind', e.target.value)}
                  aria-label={`Tax kind for row ${idx + 1}`}
                >
                  {TAX_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  max="28"
                  step="any"
                  className="invoice-recheck-input invoice-recheck-input-num"
                  value={tax.rate ?? ''}
                  onChange={(e) => onChange(idx, 'rate', e.target.value)}
                  aria-label={`Tax rate for row ${idx + 1}`}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="invoice-recheck-input invoice-recheck-input-num"
                  value={tax.base ?? ''}
                  onChange={(e) => onChange(idx, 'base', e.target.value)}
                  aria-label={`Taxable base for row ${idx + 1}`}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="invoice-recheck-input invoice-recheck-input-num"
                  value={tax.amount ?? ''}
                  onChange={(e) => onChange(idx, 'amount', e.target.value)}
                  aria-label={`Tax amount for row ${idx + 1}`}
                />
              </td>
              <td className="invoice-recheck-actions-cell">
                <button
                  type="button"
                  className="invoice-recheck-delete-btn"
                  onClick={() => onRemove?.(idx)}
                  aria-label={`Delete tax line ${idx + 1}`}
                  title="Delete tax line"
                >
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-recheck-tax-footer">
        <button type="button" className="invoice-recheck-add-tax" onClick={onAdd}>
          <Plus size={15} />
          Add tax line
        </button>
        <span className="invoice-recheck-tax-total">
          Total tax: ₹
          {totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}

export { recalcTax, TAX_KINDS };
