import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const LOGO_SRC = '/dascnclogo2.png';

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 4 });
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function companyAddress(company) {
  return [
    company?.address_line1,
    company?.address_line2,
    [company?.city, company?.state, company?.state_code].filter(Boolean).join(', '),
    company?.gstin ? `GSTIN: ${company.gstin}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#111111',
    paddingBottom: 12,
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    paddingRight: 12,
  },
  logo: { width: 48, height: 48, objectFit: 'contain', marginRight: 12 },
  companyName: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  addr: { fontSize: 9.5, color: '#555555', lineHeight: 1.5 },
  headerRight: { width: 168, alignItems: 'flex-end' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 1 },
  metaLabel: { fontSize: 9.5, color: '#888888', paddingRight: 8 },
  metaValue: { fontSize: 9.5, minWidth: 72, textAlign: 'right' },
  supplierBox: {
    borderWidth: 0.5,
    borderColor: '#cccccc',
    padding: 10,
    marginBottom: 16,
  },
  boxLabel: { fontSize: 8, color: '#888888', marginBottom: 4, textTransform: 'uppercase' },
  boxName: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 2 },
  table: { marginBottom: 12 },
  thead: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    color: '#ffffff',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  th: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#dddddd',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  td: { fontSize: 9 },
  totals: { alignItems: 'flex-end', marginTop: 8 },
  totalRow: { flexDirection: 'row', width: 200, justifyContent: 'space-between', paddingVertical: 2 },
  grand: { fontFamily: 'Helvetica-Bold', fontSize: 11, borderTopWidth: 1, borderTopColor: '#111', marginTop: 4, paddingTop: 4 },
  notes: { marginTop: 16, fontSize: 9, color: '#555555' },
  footer: {
    marginTop: 36,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sign: { width: 180, borderTopWidth: 0.5, borderTopColor: '#888', paddingTop: 6, textAlign: 'center', fontSize: 9 },
});

export default function PurchaseOrderPdfDocument({ po, company }) {
  const lines = po?.lines || [];
  const subtotal = Number(po?.total_amount) || lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const seller = company?.legal_name || company?.trade_name || 'DAS CNC';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={LOGO_SRC} style={styles.logo} />
            <View>
              <Text style={styles.companyName}>{seller}</Text>
              <Text style={styles.addr}>{companyAddress(company)}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.title}>PURCHASE ORDER</Text>
            <View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>PO No.</Text>
                <Text style={styles.metaValue}>{po?.po_number || 'DRAFT'}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Date</Text>
                <Text style={styles.metaValue}>{fmtDate(po?.sent_at || po?.created_at)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Delivery</Text>
                <Text style={styles.metaValue}>{fmtDate(po?.expected_delivery_date)}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.supplierBox}>
          <Text style={styles.boxLabel}>Supplier</Text>
          <Text style={styles.boxName}>{po?.supplier_name || '—'}</Text>
          {po?.notes ? <Text style={styles.addr}>{po.notes}</Text> : null}
        </View>

        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, { width: 28 }]}>#</Text>
            <Text style={[styles.th, { flex: 1 }]}>Item</Text>
            <Text style={[styles.th, { width: 70, textAlign: 'right' }]}>Qty</Text>
            <Text style={[styles.th, { width: 40 }]}>Unit</Text>
            <Text style={[styles.th, { width: 70, textAlign: 'right' }]}>Rate</Text>
            <Text style={[styles.th, { width: 80, textAlign: 'right' }]}>Amount</Text>
          </View>
          {lines.map((line, idx) => (
            <View key={line.id || idx} style={styles.tr} wrap={false}>
              <Text style={[styles.td, { width: 28 }]}>{line.line_no || idx + 1}</Text>
              <Text style={[styles.td, { flex: 1 }]}>{line.item_label || line.master_record_id}</Text>
              <Text style={[styles.td, { width: 70, textAlign: 'right' }]}>{fmtQty(line.quantity)}</Text>
              <Text style={[styles.td, { width: 40 }]}>{line.unit || ''}</Text>
              <Text style={[styles.td, { width: 70, textAlign: 'right' }]}>{fmt(line.unit_rate)}</Text>
              <Text style={[styles.td, { width: 80, textAlign: 'right' }]}>{fmt(line.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{fmt(subtotal)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grand]}>
            <Text>Grand Total</Text>
            <Text>INR {fmt(subtotal)}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.sign}>Authorized signatory</Text>
        </View>
      </Page>
    </Document>
  );
}
