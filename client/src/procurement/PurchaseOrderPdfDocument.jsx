import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const LOGO_SRC = '/dascnclogo2.png';
const FORM_NO = 'PUR/F/03';

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
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
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

function logoSrc() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${LOGO_SRC}`;
  }
  return LOGO_SRC;
}

function officeLine(company) {
  return (
    [
      company?.address_line1,
      company?.address_line2,
      [company?.city, company?.pincode, company?.state].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join(', ') || '—'
  );
}

function taxInstruction(po) {
  const taxes = [
    ...new Set(
      (po?.lines || [])
        .map((l) => l.tax_gst)
        .filter((v) => v != null && v !== '')
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  if (taxes.length === 1) return `GST ${taxes[0]}%`;
  if (taxes.length > 1) return 'GST as per commercials';
  return 'As applicable';
}

function paymentInstruction(po) {
  if (po?.supplier_payment_details) return po.supplier_payment_details;
  if (po?.credit_period_days) return `Within ${po.credit_period_days} days`;
  return 'Against proforma invoice.';
}

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#111111',
  },
  frame: {
    borderWidth: 1,
    borderColor: '#111111',
    minHeight: '100%',
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
    paddingBottom: 8,
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 8,
  },
  logo: { width: 48, height: 48, objectFit: 'contain', marginRight: 10 },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  tagline: { fontSize: 8, color: '#444444', letterSpacing: 0.4 },
  headerRight: { alignItems: 'flex-end', width: 150 },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  formNo: { fontSize: 8, marginTop: 3, color: '#444444' },

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    fontSize: 10,
  },
  metaStrong: { fontFamily: 'Helvetica-Bold' },

  vendorLabel: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, marginBottom: 3 },
  vendorName: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 2 },
  vendorAddr: { fontSize: 9.5, lineHeight: 1.4, marginBottom: 10 },

  greeting: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, marginBottom: 3 },
  intro: { fontSize: 9.5, marginBottom: 4 },
  note: { fontSize: 9.5, marginBottom: 10 },

  table: { marginBottom: 12, borderWidth: 1, borderColor: '#111111' },
  thead: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderBottomWidth: 1,
    borderBottomColor: '#111111',
    paddingVertical: 5,
  },
  th: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#ffffff', paddingHorizontal: 4 },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#888888',
    paddingVertical: 6,
    minHeight: 22,
  },
  td: { fontSize: 9.5, paddingHorizontal: 4 },
  cSl: { width: '10%' },
  cItem: { width: '42%' },
  cQty: { width: '16%' },
  cRate: { width: '16%', textAlign: 'right' },
  cAmt: { width: '16%', textAlign: 'right' },

  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, marginBottom: 4 },
  instr: { fontSize: 9.5, lineHeight: 1.45, marginBottom: 1 },
  instrIndent: { fontSize: 9.5, lineHeight: 1.45, marginLeft: 14, marginBottom: 1 },

  confirm: { fontSize: 9, marginTop: 10, marginBottom: 16 },

  signs: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  signCol: { width: '45%' },
  signHint: { fontSize: 9.5, marginBottom: 18 },
  signName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  signCaption: { fontSize: 8.5, marginTop: 16, fontFamily: 'Helvetica-Bold' },
  signRight: { width: '50%', alignItems: 'flex-end' },

  companyBox: {
    borderTopWidth: 1,
    borderTopColor: '#111111',
    paddingTop: 8,
  },
  companyTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, marginBottom: 3 },
  companyLine: { fontSize: 9, lineHeight: 1.45 },
});

export default function PurchaseOrderPdfDocument({ po, company }) {
  const lines = po?.lines?.length ? po.lines : [{ empty: true }];
  const seller = company?.legal_name || company?.trade_name || 'DAS CNC PRODUCTS PVT. LTD.';
  const deliveryAddress = officeLine(company);
  const phoneEmail = [
    company?.phone ? `Ph : ${company.phone}` : null,
    company?.email ? `E-MAIL : ${company.email}` : null,
  ]
    .filter(Boolean)
    .join(' , ');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.frame}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Image src={logoSrc()} style={styles.logo} />
              <View>
                <Text style={styles.companyName}>{seller}</Text>
                <Text style={styles.tagline}>PRECISION TURNED COMPONENTS</Text>
              </View>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.title}>PURCHASE ORDER</Text>
              <Text style={styles.formNo}>{FORM_NO}</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <Text>
              <Text style={styles.metaStrong}>PURCHASE ORDER NO: </Text>
              {po?.po_number || 'DRAFT'}
            </Text>
            <Text>
              <Text style={styles.metaStrong}>Date:- </Text>
              {fmtDate(po?.sent_at || po?.created_at)}
            </Text>
          </View>

          <Text style={styles.vendorLabel}>VENDOR / SUPPLIER'S NAME & ADDRESS :</Text>
          <Text style={styles.vendorName}>{po?.supplier_name || '—'}</Text>
          <Text style={styles.vendorAddr}>
            {[po?.supplier_address, po?.supplier_gstin ? `GSTIN: ${po.supplier_gstin}` : null]
              .filter(Boolean)
              .join('\n') || '—'}
          </Text>

          <Text style={styles.greeting}>DEAR SIR/MADAM,</Text>
          <Text style={styles.intro}>
            WE ARE PLEASED TO PLACE A PURCHASE ORDER FOR THE FOLLOWING ITEMS :
          </Text>
          {po?.notes ? <Text style={styles.note}>Note: {po.notes}</Text> : null}

          <View style={styles.table}>
            <View style={styles.thead}>
              <Text style={[styles.th, styles.cSl]}>SL.{'\n'}NO.</Text>
              <Text style={[styles.th, styles.cItem]}>Item's</Text>
              <Text style={[styles.th, styles.cQty]}>Qty</Text>
              <Text style={[styles.th, styles.cRate]}>Rate</Text>
              <Text style={[styles.th, styles.cAmt]}>Total Price</Text>
            </View>
            {lines.map((line, idx) => (
              <View key={line.id || idx} style={styles.tr} wrap={false}>
                <Text style={[styles.td, styles.cSl]}>{line.empty ? '' : line.line_no || idx + 1}</Text>
                <Text style={[styles.td, styles.cItem]}>
                  {line.empty ? '' : line.item_label || line.master_record_id}
                </Text>
                <Text style={[styles.td, styles.cQty]}>
                  {line.empty ? '' : `${fmtQty(line.quantity)} ${line.unit || ''}`.trim()}
                </Text>
                <Text style={[styles.td, styles.cRate]}>{line.empty ? '' : fmt(line.unit_rate)}</Text>
                <Text style={[styles.td, styles.cAmt]}>
                  {line.empty
                    ? ''
                    : fmt(line.amount ?? Number(line.quantity || 0) * Number(line.unit_rate || 0))}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>SPECIAL INSTRUCTIONS :-</Text>
          <Text style={styles.instr}>1. Payment:- {paymentInstruction(po)}</Text>
          <Text style={styles.instr}>2. Taxes :- {taxInstruction(po)}</Text>
          <Text style={styles.instr}>3. Quality : Should be very good</Text>
          <Text style={styles.instr}>4. P&F: as applicable</Text>
          <Text style={styles.instr}>5. Material delivery to below address :</Text>
          <Text style={styles.instrIndent}>{deliveryAddress}</Text>
          {po?.expected_delivery_date ? (
            <Text style={styles.instr}>
              6. Expected delivery :- {fmtDate(po.expected_delivery_date)}
            </Text>
          ) : null}

          <Text style={styles.confirm}>
            NOTE : Kindly send us a copy of this duly signed for the confirmation of acceptance of
            this Contract.
          </Text>

          <View style={styles.signs}>
            <View style={styles.signCol}>
              <Text style={styles.signHint}>Prepared by,</Text>
              <Text style={styles.signName}>{po?.created_by_name || ' '}</Text>
            </View>
            <View style={styles.signRight}>
              <Text style={styles.signHint}>For {seller}</Text>
              <Text style={styles.signCaption}>AUTHORISED SIGNATURE</Text>
            </View>
          </View>

          <View style={styles.companyBox}>
            <Text style={styles.companyTitle}>Our Company Details :</Text>
            <Text style={styles.companyLine}>GST no: {company?.gstin || '—'}</Text>
            <Text style={styles.companyLine}>Office : {deliveryAddress}</Text>
            {phoneEmail ? <Text style={styles.companyLine}>{phoneEmail}</Text> : null}
          </View>
        </View>
      </Page>
    </Document>
  );
}
