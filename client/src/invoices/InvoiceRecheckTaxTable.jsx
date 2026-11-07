import { Plus, Trash2 } from 'lucide-react';
import useHandPanScroll from './useHandPanScroll';

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

function fieldClass(base, flag, severity) {
  if (!flag) return base;
  return `${base} ${severity === 'error' ? 'invoice-field-invalid' : 'invoice-field-suspect'}`;
}

export default function InvoiceRecheckTaxTable({
  taxes,
  onChange,
  onRemove,
  onAdd,
  rowIssues = {},
}) {
  const totalTax = taxes.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const { panProps, dragging } = useHandPanScroll();

  return (
    <div
      className={`invoice-recheck-lines invoice-recheck-taxes invoice-recheck-hand-pan${dragging ? ' is-panning' : ''}`}
      title="Drag with hand tool to pan the table"
      {...panProps}
    >
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
          {taxes.map((tax, idx) => {
            const issue = rowIssues[idx] || {};
            const sev = issue.severity || 'warning';
            return (
              <tr
                key={idx}
                className={
                  issue.severity === 'error'
                    ? 'invoice-row-invalid'
                    : issue.severity === 'warning'
                      ? 'invoice-row-suspect'
                      : undefined
                }
              >
                <td>
                  <select
                    className={fieldClass('invoice-recheck-select', issue.kind, sev)}
                    value={tax.kind || 'CGST'}
                    onChange={(e) => onChange(idx, 'kind', e.target.value)}
                    aria-label={`Tax kind for row ${idx + 1}`}
                    aria-invalid={Boolean(issue.kind)}
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
                    className={fieldClass(
                      'invoice-recheck-input invoice-recheck-input-num',
                      issue.rate,
                      sev
                    )}
                    value={tax.rate ?? ''}
                    onChange={(e) => onChange(idx, 'rate', e.target.value)}
                    aria-label={`Tax rate for row ${idx + 1}`}
                    aria-invalid={Boolean(issue.rate)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={fieldClass(
                      'invoice-recheck-input invoice-recheck-input-num',
                      issue.base,
                      sev
                    )}
                    value={tax.base ?? ''}
                    onChange={(e) => onChange(idx, 'base', e.target.value)}
                    aria-label={`Taxable base for row ${idx + 1}`}
                    aria-invalid={Boolean(issue.base)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={fieldClass(
                      'invoice-recheck-input invoice-recheck-input-num',
                      issue.amount,
                      sev
                    )}
                    value={tax.amount ?? ''}
                    onChange={(e) => onChange(idx, 'amount', e.target.value)}
                    aria-label={`Tax amount for row ${idx + 1}`}
                    aria-invalid={Boolean(issue.amount)}
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
            );
          })}
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
