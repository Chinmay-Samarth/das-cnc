import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const LOGO_SRC = '/dascnclogo2.png';

const BLUE = '#0033A0';
const RED = '#C00000';
const BLACK = '#000000';
const BORDER = '#000000';
/** Light blue fill on goods table header (matches printed samples). */
const HEADER_BG = '#A8C8E8';

const GST_STATES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

const styles = StyleSheet.create({
  page: {
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 12,
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: BLACK,
  },

  title: {
    textAlign: 'center',
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },

  frame: {
    borderWidth: 1.75,
    borderColor: BORDER,
    flexGrow: 1,
    flexDirection: 'column',
  },

  /* ── Company + invoice meta ── */
  topRow: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: BORDER,
  },
  sellerCol: {
    flex: 1.65,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 10,
    borderRightWidth: 1.25,
    borderRightColor: BORDER,
  },
  gstinLine: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 3,
  },
  companyName: {
    fontSize: 17,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 4,
  },
  sellerAddr: {
    fontSize: 10.5,
    color: BLACK,
    lineHeight: 1.4,
  },

  metaCol: {
    flex: 1,
    flexDirection: 'column',
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 8,
  },
  logoStrip: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  logo: {
    width: 110,
    height: 38,
    objectFit: 'contain',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    minHeight: 22,
  },
  metaLabelRed: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: RED,
  },
  metaValueRed: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: RED,
  },
  metaLabel: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: BLACK,
  },
  metaValue: {
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: BLACK,
  },

  /* ── Bill / Ship ── */
  partyHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1.25,
    borderBottomColor: BORDER,
  },
  partyHeaderCell: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partyHeaderLeft: {
    borderRightWidth: 1.25,
    borderRightColor: BORDER,
  },
  partyHeaderText: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },

  partyBodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: BORDER,
  },
  partyBodyCol: {
    flex: 1,
    paddingTop: 7,
    paddingBottom: 7,
    paddingHorizontal: 10,
  },
  partyBodyLeft: {
    borderRightWidth: 1.25,
    borderRightColor: BORDER,
  },
  partyField: {
    fontSize: 11,
    marginBottom: 3,
    lineHeight: 1.4,
  },
  bold: {
    fontFamily: 'Helvetica-Bold',
  },

  /* ── Goods table ── */
  th: {
    flexDirection: 'row',
    backgroundColor: HEADER_BG,
    borderTopWidth: 1.25,
    borderTopColor: BORDER,
    borderBottomWidth: 1.25,
    borderBottomColor: BORDER,
    minHeight: 32,
  },
  thCell: {
    borderRightWidth: 1.25,
    borderRightColor: BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  thCellLast: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  thText: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: BLACK,
    textAlign: 'center',
    lineHeight: 1.2,
  },

  goodsBody: {
    flexGrow: 1,
    flexDirection: 'column',
    position: 'relative',
    borderBottomWidth: 1.75,
    borderBottomColor: BORDER,
  },
  /** Grows to push totals down; column rules are drawn on goodsBody. */
  goodsFill: {
    flexGrow: 1,
    minHeight: 48,
  },
  /** Full-height column rules — one continuous stroke (no row/fill seam). */
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.25,
    backgroundColor: BORDER,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 64,
  },
  tdCell: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tdCellLast: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  td: {
    fontSize: 11,
    color: BLACK,
  },
  tdBold: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: BLACK,
  },
  tdCenter: { textAlign: 'center' },
  tdRight: { textAlign: 'right' },
  tdWrap: {
    textAlign: 'left',
  },
  descMain: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  descSub: {
    fontSize: 11,
    fontFamily: 'Helvetica',
  },
  poSub: {
    fontSize: 9,
    fontFamily: 'Helvetica',
    marginTop: 2,
    textAlign: 'left',
  },

  cSl: { width: '6%' },
  cPo: { width: '13%' },
  cHsn: { width: '11%' },
  cDesc: { width: '23%' },
  cPkg: { width: '14%' },
  cQty: { width: '10%' },
  cRate: { width: '11%' },
  cAmt: { width: '12%' },

  /* ── Totals ── */
  totalsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: BORDER,
  },
  wordsCol: {
    flex: 1.55,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRightWidth: 1.25,
    borderRightColor: BORDER,
  },
  wordsLabel: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  wordsValue: {
    fontSize: 11,
    marginBottom: 10,
    lineHeight: 1.4,
  },
  termsLine: {
    fontSize: 11,
    marginBottom: 4,
  },

  calcCol: {
    flex: 1,
  },
  calcRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    minHeight: 22,
  },
  calcLabel: {
    flex: 1.4,
    fontSize: 10.5,
    fontFamily: 'Helvetica-Bold',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  calcPct: {
    width: 36,
    fontSize: 10.5,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingVertical: 4,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  calcValue: {
    flex: 1,
    fontSize: 10.5,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  grandRow: {
    flexDirection: 'row',
    borderTopWidth: 2,
    borderTopColor: BORDER,
    minHeight: 28,
  },
  grandLabel: {
    flex: 1.4,
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  grandPct: {
    width: 36,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  grandValue: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    paddingVertical: 6,
    paddingHorizontal: 6,
  },

  /* ── Footer ── */
  certify: {
    fontSize: 9,
    lineHeight: 1.45,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: BORDER,
  },
  signs: {
    flexDirection: 'row',
    minHeight: 100,
  },
  signLeft: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRightWidth: 1.25,
    borderRightColor: BORDER,
    justifyContent: 'space-between',
  },
  signRight: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  signText: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
  },
  signTextRight: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
  },

  watermark: {
    position: 'absolute',
    top: '42%',
    left: '16%',
    fontSize: 48,
    color: '#dc2626',
    opacity: 0.16,
    transform: 'rotate(-28deg)',
    fontFamily: 'Helvetica-Bold',
  },
});

function money(n, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function qtyLabel(line) {
  const n = Number(line?.quantity);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
}

/** Insert soft break opportunities so long PO refs wrap inside the column. */
function wrapFriendlyPo(value) {
  const s = String(value || '');
  if (!s) return '';
  return s.replace(/([-/_.])/g, '$1\u200B');
}

function formatInvoiceDate(value) {
  if (value == null || value === '') return null;
  const str = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) return `${Number(iso[3])}/${Number(iso[2])}/${iso[1]}`;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function stateName(code, fallback) {
  const padded = String(code || '').padStart(2, '0').slice(0, 2);
  return GST_STATES[padded] || fallback || null;
}

function twoDigit(n) {
  const v = Math.floor(n);
  if (v < 20) return ONES[v];
  const t = Math.floor(v / 10);
  const o = v % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ''}`.trim();
}

function chunkToWords(n) {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigit(rest));
  return parts.join(' ');
}

function integerToWords(n) {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts = [];
  if (crore) parts.push(`${chunkToWords(crore)} Crore`);
  if (lakh) parts.push(`${chunkToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${chunkToWords(thousand)} Thousand`);
  if (rest) parts.push(chunkToWords(rest));
  return parts.join(' ');
}

function rupeesInWordsForm(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const rupees = Math.floor(Math.abs(n) + 1e-9);
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  let text = `Rs. ${integerToWords(rupees)}`;
  if (paise) text += ` and ${twoDigit(paise)} Paise`;
  text += ' Only.';
  return text;
}

function logoSrc() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${LOGO_SRC}`;
  }
  return LOGO_SRC;
}

function FieldLine({ label, value, boldValue = false }) {
  return (
    <Text style={styles.partyField}>
      <Text style={styles.bold}>{label}</Text>
      {' : '}
      <Text style={boldValue ? styles.bold : null}>{value || ''}</Text>
    </Text>
  );
}

function CalcRow({ label, pct, value }) {
  return (
    <View style={styles.calcRow}>
      <Text style={styles.calcLabel}>{label}</Text>
      <Text style={styles.calcPct}>{pct || ''}</Text>
      <Text style={styles.calcValue}>{value}</Text>
    </View>
  );
}

function ThStacked({ width, line1, line2, last }) {
  return (
    <View style={[last ? styles.thCellLast : styles.thCell, width]}>
      <Text style={styles.thText}>{line1}</Text>
      {line2 ? <Text style={styles.thText}>{line2}</Text> : null}
    </View>
  );
}

export function SalesInvoicePdfDocument({ invoice }) {
  const company = invoice?.company_snapshot || {};
  const customer = invoice?.customer_snapshot || {};
  const lines = Array.isArray(invoice?.line_items) ? invoice.line_items : [];
  const cancelled = invoice?.status === 'cancelled';
  const companyTitle =
    company.trade_name || company.legal_name || 'Das CNC Products Pvt ltd.';

  const addressLine1 = company.address_line1 || '';
  const cityPin = [company.city, company.pincode].filter(Boolean).join('-');
  const addressLine2 = [company.address_line2, cityPin, company.state, 'India']
    .filter(Boolean)
    .join(', ');

  const billStateCode =
    invoice?.place_of_supply_state_code || customer.state_code || null;
  const billState = stateName(billStateCode, customer.state);
  const customerName = (
    customer.name ||
    invoice?.customer_name ||
    'Customer'
  ).toUpperCase();
  const billAddress =
    customer.billing_address || customer.official_address || '';
  const shipAddress =
    customer.official_address ||
    customer.billing_address ||
    customer.shipping_address ||
    billAddress;

  const freight = Number(invoice?.freight_amount) || 0;
  const taxable = Number(invoice?.taxable_amount) || 0;
  const cgst = Number(invoice?.cgst_amount) || 0;
  const sgst = Number(invoice?.sgst_amount) || 0;
  const igst = Number(invoice?.igst_amount) || 0;
  const taxAmount = cgst + sgst + igst;
  const preRound = taxable + freight + cgst + sgst + igst;
  const storedTotal = Number(invoice?.total_amount);
  const grand = Number.isFinite(storedTotal)
    ? Math.round(storedTotal)
    : Math.round(preRound);
  const roundOff = Math.round((grand - preRound) * 100) / 100;
  const displayLines = lines.length ? lines : [{ empty: true }];
  const isIgst = invoice?.tax_type === 'IGST';

  const paymentTermsRaw = invoice?.payment_terms || '30 Days';
  const paymentTerms = /[.]$/.test(String(paymentTermsRaw).trim())
    ? String(paymentTermsRaw).trim()
    : `${String(paymentTermsRaw).trim()}.`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {cancelled ? <Text style={styles.watermark}>CANCELLED</Text> : null}

        <Text style={styles.title}>Tax Invoice</Text>

        <View style={styles.frame}>
          {/* Company + meta */}
          <View style={styles.topRow}>
            <View style={styles.sellerCol}>
              {company.gstin ? (
                <Text style={styles.gstinLine}>GSTIN NO: {company.gstin}</Text>
              ) : null}
              <Text style={styles.companyName}>{companyTitle}</Text>
              {addressLine1 ? (
                <Text style={styles.sellerAddr}>{addressLine1}</Text>
              ) : null}
              {addressLine2 ? (
                <Text style={styles.sellerAddr}>{addressLine2}</Text>
              ) : null}
              {company.phone ? (
                <Text style={styles.sellerAddr}>Phone: {company.phone}</Text>
              ) : null}
            </View>

            <View style={styles.metaCol}>
              <View style={styles.logoStrip}>
                <Image src={logoSrc()} style={styles.logo} />
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabelRed}>Invoice no : </Text>
                <Text style={styles.metaValueRed}>
                  {invoice?.invoice_number || '(Draft)'}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Invoice Date : </Text>
                <Text style={styles.metaValue}>
                  {formatInvoiceDate(invoice?.issued_at) || ''}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Vender code : </Text>
                <Text style={styles.metaValue}>
                  {customer.vendor_code || invoice?.vendor_code || ''}
                </Text>
              </View>
            </View>
          </View>

          {/* Bill / Ship headers */}
          <View style={styles.partyHeaderRow}>
            <View style={[styles.partyHeaderCell, styles.partyHeaderLeft]}>
              <Text style={styles.partyHeaderText}>Bill to Party</Text>
            </View>
            <View style={styles.partyHeaderCell}>
              <Text style={styles.partyHeaderText}>Ship to Party</Text>
            </View>
          </View>

          <View style={styles.partyBodyRow}>
            <View style={[styles.partyBodyCol, styles.partyBodyLeft]}>
              <FieldLine label="Name" value={customerName} boldValue />
              <FieldLine label="Address" value={billAddress} />
              <FieldLine label="GSTIN" value={customer.gstin} boldValue />
              <FieldLine label="State" value={billState} />
              <FieldLine label="Pan no" value={customer.pan_no} />
            </View>
            <View style={styles.partyBodyCol}>
              <FieldLine label="Name" value={customerName} boldValue />
              <FieldLine label="Address" value={shipAddress} />
              <FieldLine label="GSTIN" value={customer.gstin} boldValue />
              <FieldLine label="State" value={billState} />
              <FieldLine label="Pan no" value={customer.pan_no} />
            </View>
          </View>

          {/* Column headers — stacked labels like the printed form */}
          <View style={styles.th}>
            <ThStacked width={styles.cSl} line1="SL" line2="No" />
            <ThStacked width={styles.cPo} line1="Purchase" line2="Order" />
            <ThStacked width={styles.cHsn} line1="HSN code" />
            <ThStacked width={styles.cDesc} line1="Description of goods" />
            <ThStacked width={styles.cPkg} line1="Package" line2="Description" />
            <ThStacked width={styles.cQty} line1="Qty" />
            <ThStacked width={styles.cRate} line1="Rate" />
            <ThStacked width={styles.cAmt} line1="Amount" last />
          </View>

          {/* Goods rows + flexible empty space so footer sits near page bottom */}
          <View style={styles.goodsBody}>
            {/* Continuous column rules for the full goods area (no gaps at row seams) */}
            <View style={[styles.vLine, { left: '6%' }]} />
            <View style={[styles.vLine, { left: '19%' }]} />
            <View style={[styles.vLine, { left: '30%' }]} />
            <View style={[styles.vLine, { left: '53%' }]} />
            <View style={[styles.vLine, { left: '67%' }]} />
            <View style={[styles.vLine, { left: '77%' }]} />
            <View style={[styles.vLine, { left: '88%' }]} />

            {displayLines.map((line, idx) => {
              if (line.empty) {
                return (
                  <View key={idx} style={styles.tr} wrap={false}>
                    <View style={[styles.tdCell, styles.cSl]}>
                      <Text style={[styles.td, styles.tdCenter]} />
                    </View>
                    <View style={[styles.tdCell, styles.cPo]} />
                    <View style={[styles.tdCell, styles.cHsn]} />
                    <View style={[styles.tdCell, styles.cDesc]} />
                    <View style={[styles.tdCell, styles.cPkg]} />
                    <View style={[styles.tdCell, styles.cQty]} />
                    <View style={[styles.tdCell, styles.cRate]} />
                    <View style={[styles.tdCellLast, styles.cAmt]} />
                  </View>
                );
              }
              const poRef = line.po_ref || invoice?.blanket_number || '';
              const poDate = formatInvoiceDate(line.po_date || invoice?.blanket_created_at);
              return (
                <View key={idx} style={styles.tr} wrap={false}>
                  <View style={[styles.tdCell, styles.cSl]}>
                    <Text style={[styles.tdBold, styles.tdCenter]}>{idx + 1}</Text>
                  </View>
                  <View style={[styles.tdCell, styles.cPo]}>
                    <Text style={[styles.tdBold, styles.tdWrap]} wrap>
                      {wrapFriendlyPo(poRef)}
                    </Text>
                    {poDate ? <Text style={styles.poSub}>{poDate}</Text> : null}
                  </View>
                  <View style={[styles.tdCell, styles.cHsn]}>
                    <Text style={[styles.td, styles.tdCenter]}>{line.hsn || ''}</Text>
                  </View>
                  <View style={[styles.tdCell, styles.cDesc]}>
                    <Text style={styles.descMain}>
                      {line.description || 'Item'}
                    </Text>
                    {line.drawing_number ? (
                      <Text style={styles.descSub}>{line.drawing_number}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.tdCell, styles.cPkg]}>
                    <Text style={styles.td}>{line.package || ''}</Text>
                  </View>
                  <View style={[styles.tdCell, styles.cQty]}>
                    <Text style={[styles.tdBold, styles.tdRight]}>
                      {qtyLabel(line)}
                    </Text>
                  </View>
                  <View style={[styles.tdCell, styles.cRate]}>
                    <Text style={[styles.tdBold, styles.tdRight]}>
                      {money(line.unit_price, 3)}
                    </Text>
                  </View>
                  <View style={[styles.tdCellLast, styles.cAmt]}>
                    <Text style={[styles.tdBold, styles.tdRight]}>
                      {money(line.taxable_amount)}
                    </Text>
                  </View>
                </View>
              );
            })}
            <View style={styles.goodsFill}>
              <Text style={{ fontSize: 1, color: '#ffffff' }}> </Text>
            </View>
          </View>

          {/* Words + 3-column tax calc */}
          <View style={styles.totalsRow}>
            <View style={styles.wordsCol}>
              <Text style={styles.wordsLabel}>Total Tax amount(in words)</Text>
              <Text style={styles.wordsValue}>{rupeesInWordsForm(taxAmount)}</Text>

              <Text style={styles.wordsLabel}>Total invoice value (in words)</Text>
              <Text style={styles.wordsValue}>{rupeesInWordsForm(grand)}</Text>

              <Text style={styles.termsLine}>
                <Text style={styles.bold}>Payment terms : </Text>
                {paymentTerms}
              </Text>
              <Text style={styles.termsLine}>
                <Text style={styles.bold}>Mode of Transport : </Text>
                {invoice?.mode_of_transport || 'By Road'}
                {'     '}
                <Text style={styles.bold}>Vehical no: </Text>
                {invoice?.vehicle_no || invoice?.vehicle_number || ''}
              </Text>
            </View>

            <View style={styles.calcCol}>
              <CalcRow
                label={`Fright / P&F %`}
                value={freight === 0 ? '0' : money(freight)}
              />
              <CalcRow label="Total Value %" value={money(taxable)} />
              {isIgst ? (
                <CalcRow label="IGST" pct="18%" value={money(igst)} />
              ) : (
                <>
                  <CalcRow label="CGST" pct="9%" value={money(cgst)} />
                  <CalcRow label="SGST" pct="9%" value={money(sgst)} />
                </>
              )}
              <CalcRow
                label="Total Tax Amount"
                value={
                  Number.isInteger(taxAmount) ? String(Math.round(taxAmount)) : money(taxAmount)
                }
              />
              <CalcRow
                label="Round Off %"
                value={
                  roundOff < 0
                    ? `-${money(Math.abs(roundOff))}`
                    : money(roundOff)
                }
              />
              <View style={styles.grandRow}>
                <Text style={styles.grandLabel}>Grand Total</Text>
                <View style={styles.grandPct} />
                <Text style={styles.grandValue}>{money(grand)}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.certify}>
            Certify that the Particulars given above are true and correct and the
            Amount indicated represent the price actually charges and that there is
            no additional consideration directly from the buyer.
          </Text>

          <View style={styles.signs}>
            <View style={styles.signLeft}>
              <View>
                <Text style={styles.signText}>Received the above goods in</Text>
                <Text style={styles.signText}>good condition</Text>
              </View>
              <Text style={styles.signText}>Sign.with Seal</Text>
            </View>
            <View style={styles.signRight}>
              <Text style={styles.signTextRight}>For {companyTitle}</Text>
              <Text style={styles.signTextRight}>Authorised Signatory</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export default SalesInvoicePdfDocument;
