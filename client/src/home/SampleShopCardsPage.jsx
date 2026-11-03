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
  operation: 'First operation',
  quantity: '25',
};

const SAMPLE_LINE = {
  row: '2',
  date: new Date().toISOString().slice(0, 10),
  operator: 'Operator',
  operation: 'Second operation',
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
        date={lotDate}
        operator={lot.operator}
        operation={lot.operation}
        quantity={lot.quantity}
      />
      <LotCardSheet
        onlyRowIndex={Math.max(0, Number(line.row) - 1)}
        date={lineDate}
        operator={line.operator}
        operation={line.operation}
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
        subtitle="Edit the fields, then print a lot card and an identification tag on A6 sheets."
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
        These cards are not saved. Live lot cards still print from My Today, and identification tags print when a GIRN is auto-approved or rejected.
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
            <Field label="Operation" value={lot.operation} onChange={(value) => setLotField('operation', value)} />
            <Field label="Qty" value={lot.quantity} onChange={(value) => setLotField('quantity', value)} />
          </div>

          <h2 className="hp-panel-title sample-cards-second-title">Next operation line</h2>
          <p className="muted">
            Prints only this line. Feed the full lot card back into the printer to check that it lands on the blank row.
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
                    </option>
                  );
                })}
              </select>
            </label>
            <Field label="Date" type="date" value={line.date} onChange={(value) => setLineField('date', value)} />
            <Field label="Operator" value={line.operator} onChange={(value) => setLineField('operator', value)} />
            <Field label="Operation" value={line.operation} onChange={(value) => setLineField('operation', value)} />
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
