import { CATEGORY_OPTIONS } from '../girn/girnCategoryConfig';
import { Plus, Trash2 } from 'lucide-react';
import useHandPanScroll from './useHandPanScroll';

function fmt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function fieldClass(base, flag, severity) {
  if (!flag) return base;
  return `${base} ${severity === 'error' ? 'invoice-field-invalid' : 'invoice-field-suspect'}`;
}

export default function InvoiceRecheckLineTable({
  lines,
  onChange,
  onCategoryChange,
  onRemove,
  onAdd,
  rowIssues = {},
}) {
  const { panProps, dragging } = useHandPanScroll();

  return (
    <div
      className={`invoice-recheck-lines invoice-recheck-hand-pan${dragging ? ' is-panning' : ''}`}
      title="Drag with hand tool to pan the table"
      {...panProps}
    >
      <table className="app-table">
        <thead>
          <tr>
            <th>Invoice line</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={6} className="invoice-recheck-empty">
                No line items. Add a line if the invoice has items OCR did not pick up.
              </td>
            </tr>
          ) : null}
          {lines.map((line, idx) => {
            const category = line.item_category || 'raw_material';
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
                  {line.manual || !(line.scanned_description || line.description) ? (
                    <input
                      type="text"
                      className="invoice-recheck-input"
                      value={line.scanned_description || line.item_description || ''}
                      onChange={(e) => onChange(idx, 'scanned_description', e.target.value)}
                      placeholder="Invoice line"
                      aria-label={`Invoice line ${idx + 1}`}
                    />
                  ) : (
                    <>
                      <div className="invoice-recheck-line-name">{line.scanned_description || line.description || '—'}</div>
                    </>
                  )}
                </td>
                <td>
                  <select
                    value={category}
                    onChange={(e) => onCategoryChange(idx, e.target.value)}
                    className="invoice-recheck-select"
                  >
                    {CATEGORY_OPTIONS.filter((opt) => opt.value !== 'unfinished_lot' && opt.value !== 'component').map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={fieldClass(
                      'invoice-recheck-input invoice-recheck-input-num',
                      issue.quantity,
                      sev
                    )}
                    value={line.quantity ?? ''}
                    onChange={(e) => onChange(idx, 'quantity', e.target.value)}
                    aria-label={`Quantity for line ${idx + 1}`}
                    aria-invalid={Boolean(issue.quantity)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={fieldClass(
                      'invoice-recheck-input invoice-recheck-input-num',
                      issue.unit_price,
                      sev
                    )}
                    value={line.unit_price ?? ''}
                    onChange={(e) => onChange(idx, 'unit_price', e.target.value)}
                    aria-label={`Rate for line ${idx + 1}`}
                    aria-invalid={Boolean(issue.unit_price)}
                  />
                </td>
                <td
                  className={`invoice-recheck-amount${
                    issue.total
                      ? issue.severity === 'error'
                        ? ' invoice-field-invalid'
                        : ' invoice-field-suspect'
                      : ''
                  }`}
                >
                  ₹{fmt(line.total)}
                </td>
                <td className="invoice-recheck-actions-cell">
                  <button
                    type="button"
                    className="invoice-recheck-delete-btn"
                    onClick={() => onRemove?.(idx)}
                    aria-label={`Delete line ${idx + 1}`}
                    title="Delete line"
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
          Add line item
        </button>
      </div>
    </div>
  );
}
