import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { AlertBanner, PageHeader } from '../components/mes';
import { GirnTagSheet, LOT_CARD_ROWS, LotCardSheet, printShopCards } from '../components/mes/ShopCardPrint';
import { formatDisplayDate } from '../utils/dateFormat';

const SAMPLE_LOT = {
  lotNumber: 'LT-SAMPLE-001',
  componentName: 'Sample component',
  girnNumber: '',
  machineNumber: '',
  date: new Date().toISOString().slice(0, 10),
  operator: 'Operator',
  quantity: '25',
  operationsText: ['Turning', 'Milling', 'Drilling', 'Inspection', 'Packing'].join('\n'),
};

const SAMPLE_LINE = {
  row: '2',
  date: new Date().toISOString().slice(0, 10),
  operator: 'Operator',
  quantity: '20',
};

const SAMPLE_TAG = {
  supplierName: 'Sample supplier',
  materialName: 'Sample material',
  girnNumber: 'GIRN-SAMPLE-001',
  receivedDate: new Date().toISOString().slice(0, 10),
  quantityKg: '12.5',
  quantityNos: '',
  status: 'approved',
  approvedBy: 'Sample employee',
};

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label>
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function parseOperations(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, LOT_CARD_ROWS);
}

export default function SampleShopCardsPage() {
  const navigate = useNavigate();
  const [lot, setLot] = useState(SAMPLE_LOT);
  const [line, setLine] = useState(SAMPLE_LINE);
  const [tag, setTag] = useState(SAMPLE_TAG);

  const lotDate = useMemo(() => (lot.date ? formatDisplayDate(lot.date) : ''), [lot.date]);
  const lineDate = useMemo(() => (line.date ? formatDisplayDate(line.date) : ''), [line.date]);
  const tagDate = useMemo(
    () => (tag.receivedDate ? formatDisplayDate(tag.receivedDate) : ''),
    [tag.receivedDate]
  );
  const operations = useMemo(() => parseOperations(lot.operationsText), [lot.operationsText]);

  function setLotField(key, value) {
    setLot((current) => ({ ...current, [key]: value }));
  }

  function setLineField(key, value) {
    setLine((current) => ({ ...current, [key]: value }));
  }

  function setTagField(key, value) {
    setTag((current) => ({ ...current, [key]: value }));
  }

  const sheets = (
    <>
      <LotCardSheet
        lotNumber={lot.lotNumber}
        componentName={lot.componentName}
        girnNumber={lot.girnNumber}
        machineNumber={lot.machineNumber}
        operations={operations}
        date={lotDate}
        operator={lot.operator}
        quantity={lot.quantity}
      />
      <LotCardSheet
        operations={operations}
        onlyRowIndex={Math.max(0, Number(line.row) - 1)}
        date={lineDate}
        operator={line.operator}
        quantity={line.quantity}
      />
      <GirnTagSheet
        supplierName={tag.supplierName}
        materialName={tag.materialName}
        girnNumber={tag.girnNumber}
        receivedDate={tagDate}
        quantityKg={tag.quantityKg}
        quantityNos={tag.quantityNos}
        status={tag.status}
        approvedBy={tag.status === 'approved' ? tag.approvedBy : ''}
        rejectedBy={tag.status === 'rejected' ? tag.approvedBy : ''}
      />
    </>
  );

  return (
    <main className="mes-shell mes-shell-wide">
      <PageHeader
        eyebrow="Temporary"
        title="Sample shop cards"
        subtitle="Edit the fields, then print a lot card and an identification tag on A6 portrait (105 × 148 mm)."
        actions={
          <>
            <button type="button" className="neutral-button" onClick={() => navigate('/home')}>
              Back to home
            </button>
            <button type="button" className="mes-btn mes-btn-primary" onClick={printShopCards}>
              <Printer size={16} />
              Print samples
            </button>
          </>
        }
      />

      <AlertBanner tone="amber" title="Temporary sample tool">
        First print includes all activity-flow operation names. Later lines only print date, operator, and qty.
      </AlertBanner>

      <div className="sample-cards-layout">
        <section className="mes-card">
          <h2 className="hp-panel-title">Lot card</h2>
          <div className="mes-filters sample-cards-fields">
            <Field label="Lot number" value={lot.lotNumber} onChange={(value) => setLotField('lotNumber', value)} />
            <Field label="Component" value={lot.componentName} onChange={(value) => setLotField('componentName', value)} />
            <Field label="GIRN No." value={lot.girnNumber} onChange={(value) => setLotField('girnNumber', value)} />
            <Field label="Machine No." value={lot.machineNumber} onChange={(value) => setLotField('machineNumber', value)} />
            <Field label="Date" type="date" value={lot.date} onChange={(value) => setLotField('date', value)} />
            <Field label="Operator" value={lot.operator} onChange={(value) => setLotField('operator', value)} />
            <Field label="Qty" value={lot.quantity} onChange={(value) => setLotField('quantity', value)} />
            <label style={{ gridColumn: '1 / -1' }}>
              Operations (one per line, from activity flow)
              <textarea
                rows={Math.min(LOT_CARD_ROWS, 6)}
                value={lot.operationsText}
                onChange={(event) => setLotField('operationsText', event.target.value)}
              />
            </label>
          </div>

          <h2 className="hp-panel-title sample-cards-second-title">Next operation line</h2>
          <p className="muted">
            Prints only date, operator, and qty. Feed the full lot card back so the values land on the blank metrics for that row.
          </p>
          <div className="mes-filters sample-cards-fields">
            <label>
              Line
              <select value={line.row} onChange={(event) => setLineField('row', event.target.value)}>
                {Array.from({ length: LOT_CARD_ROWS - 1 }, (_, index) => {
                  const row = String(index + 2);
                  return (
                    <option key={row} value={row}>
                      Line {row}
                      {operations[index + 1] ? ` · ${operations[index + 1]}` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <Field label="Date" type="date" value={line.date} onChange={(value) => setLineField('date', value)} />
            <Field label="Operator" value={line.operator} onChange={(value) => setLineField('operator', value)} />
            <Field label="Qty" value={line.quantity} onChange={(value) => setLineField('quantity', value)} />
          </div>

          <h2 className="hp-panel-title sample-cards-second-title">Identification tag</h2>
          <div className="mes-filters sample-cards-fields">
            <Field label="Supplier" value={tag.supplierName} onChange={(value) => setTagField('supplierName', value)} />
            <Field label="Material" value={tag.materialName} onChange={(value) => setTagField('materialName', value)} />
            <Field label="GIRN No." value={tag.girnNumber} onChange={(value) => setTagField('girnNumber', value)} />
            <Field label="Received date" type="date" value={tag.receivedDate} onChange={(value) => setTagField('receivedDate', value)} />
            <Field label="Kgs" value={tag.quantityKg} onChange={(value) => setTagField('quantityKg', value)} />
            <Field label="Nos" value={tag.quantityNos} onChange={(value) => setTagField('quantityNos', value)} />
            <Field
              label={tag.status === 'rejected' ? 'Rejected by' : 'Approved by'}
              value={tag.approvedBy}
              onChange={(value) => setTagField('approvedBy', value)}
            />
            <label>
              Decision
              <select value={tag.status} onChange={(event) => setTagField('status', event.target.value)}>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>
        </section>

        <section className="shop-card-preview sample-cards-preview" aria-label="Card preview">
          {sheets}
        </section>
      </div>

      <div className="shop-card-print-root" aria-hidden="true">
        {sheets}
      </div>
    </main>
  );
}
