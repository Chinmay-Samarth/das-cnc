import MasterItemSelect from '../girn/MasterItemSelect';
import { CATEGORY_OPTIONS, getCategoryConfig, hasMasterLink } from '../girn/girnCategoryConfig';

function fmt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

export default function InvoiceRecheckLineTable({ lines, onChange, onMasterSelect, onCategoryChange }) {
  return (
    <div className="invoice-recheck-lines">
      <table className="app-table">
        <thead>
          <tr>
            <th>Invoice line</th>
            <th>Category</th>
            <th>Master record</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const category = line.item_category || 'raw_material';
            const cfg = getCategoryConfig(category);
            const showMaster = hasMasterLink(category);

            return (
              <tr key={idx}>
                <td>
                  <div className="invoice-recheck-line-name">{line.scanned_description || line.description || '—'}</div>
                  {line.match_confidence && line.match_confidence !== 'high' ? (
                    <span className="invoice-recheck-match muted">{line.match_confidence} match</span>
                  ) : null}
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
                  {showMaster ? (
                    <MasterItemSelect
                      masterSlug={cfg.masterSlug}
                      category={category}
                      value={line.master_record_id}
                      label={line.master_record_label}
                      onChange={(mapped) => onMasterSelect(idx, mapped)}
                    />
                  ) : (
                    <input
                      type="text"
                      className="invoice-recheck-input"
                      value={line.item_description || line.scanned_description || ''}
                      onChange={(e) => onChange(idx, 'item_description', e.target.value)}
                      placeholder="Description"
                    />
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="invoice-recheck-input invoice-recheck-input-num"
                    value={line.quantity ?? ''}
                    onChange={(e) => onChange(idx, 'quantity', e.target.value)}
                    aria-label={`Quantity for line ${idx + 1}`}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="invoice-recheck-input invoice-recheck-input-num"
                    value={line.unit_price ?? ''}
                    onChange={(e) => onChange(idx, 'unit_price', e.target.value)}
                    aria-label={`Rate for line ${idx + 1}`}
                  />
                </td>
                <td className="invoice-recheck-amount">₹{fmt(line.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
