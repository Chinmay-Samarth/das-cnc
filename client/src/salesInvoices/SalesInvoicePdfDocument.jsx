import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const LOGO_SRC = '/dascnclogo2.png';

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
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

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
  logo: {
    width: 48,
    height: 48,
    objectFit: 'contain',
    marginRight: 12,
  },
  companyName: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    marginBottom: 3,
  },
  addr: {
    fontSize: 9.5,
    color: '#555555',
    lineHeight: 1.5,
  },

  headerRight: {
    width: 168,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    textAlign: 'right',
  },
  metaTable: {
    marginTop: 6,
    width: 168,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 1,
  },
  metaLabel: {
    fontSize: 9.5,
    color: '#888888',
    paddingRight: 8,
    textAlign: 'right',
  },
  metaValue: {
    fontSize: 9.5,
    color: '#111111',
    textAlign: 'right',
    minWidth: 72,
  },

  parties: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: '#cccccc',
    marginBottom: 16,
  },
  partyCol: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  partyColLeft: {
    borderRightWidth: 0.5,
    borderRightColor: '#cccccc',
  },
  sectionLabel: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
    color: '#888888',
    marginBottom: 5,
  },
  partyName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    marginBottom: 3,
  },
  body: {
    fontSize: 9.5,
    color: '#555555',
    lineHeight: 1.55,
  },

  table: {
    width: '100%',
    marginBottom: 4,
  },
  th: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f2',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#cccccc',
    paddingVertical: 7,
  },
  thText: {
    fontSize: 9,
    color: '#444444',
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 5,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 0.5,
    borderBottomColor: '#eeeeee',
    paddingVertical: 8,
  },
  td: {
    fontSize: 9.5,
    color: '#1a1a1a',
    paddingHorizontal: 5,
  },
  tdMuted: {
    fontSize: 9.5,
    color: '#666666',
    paddingHorizontal: 5,
  },
  tdSub: {
    fontSize: 8.5,
    color: '#999999',
  },
  tableRule: {
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    marginBottom: 14,
  },

  cSl: { width: '6%' },
  cPo: { width: '13%' },
  cHsn: { width: '11%' },
  cDesc: { width: '25%' },
  cPkg: { width: '13%' },
  cQty: { width: '10%', textAlign: 'right' },
  cRate: { width: '10%', textAlign: 'right' },
  cAmt: { width: '12%', textAlign: 'right' },

  totalsWrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  wordsCol: {
    flex: 1.3,
    paddingRight: 16,
  },
  wordsLabel: {
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
    color: '#888888',
    marginBottom: 5,
  },
  wordsText: {
    fontSize: 9.5,
    color: '#555555',
    lineHeight: 1.6,
  },
  paymentTerms: {
    fontSize: 9.5,
    color: '#555555',
    marginTop: 10,
  },
  totals: {
    width: 210,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalLabel: {
    fontSize: 9.5,
    color: '#666666',
  },
  totalValue: {
    fontSize: 9.5,
    color: '#1a1a1a',
    textAlign: 'right',
  },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1.5,
    borderTopColor: '#111111',
  },
  grandLabel: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
  },
  grandValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    textAlign: 'right',
  },

  certify: {
    fontSize: 8.5,
    color: '#888888',
    lineHeight: 1.6,
    borderTopWidth: 0.5,
    borderTopColor: '#dddddd',
    paddingTop: 10,
    marginBottom: 18,
  },

  signs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signCol: {
    flex: 1,
  },
  signColRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  signHint: {
    fontSize: 9,
    color: '#666666',
  },
  signSpace: {
    height: 30,
  },
  signLine: {
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
    paddingTop: 4,
    minWidth: 160,
  },
  signCaption: {
    fontSize: 9,
    color: '#888888',
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

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyLabel(line) {
  const n = Number(line?.quantity);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN');
}

function formatPdfDate(value) {
  if (value == null || value === '') return null;
  const str = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
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
  if (hundred) parts.push(`${ONES[hundred]} hundred`);
  if (rest) parts.push(twoDigit(rest));
  return parts.join(' ');
}

function integerToWords(n) {
  if (n === 0) return 'zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts = [];
  if (crore) parts.push(`${chunkToWords(crore)} crore`);
  if (lakh) parts.push(`${chunkToWords(lakh)} lakh`);
  if (thousand) parts.push(`${chunkToWords(thousand)} thousand`);
  if (rest) parts.push(chunkToWords(rest));
  return parts.join(' ');
}

function rupeesInWords(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const rupees = Math.floor(Math.abs(n) + 1e-9);
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  let text = `Rupees ${integerToWords(rupees)}`;
  if (paise) text += ` and ${twoDigit(paise)} paise`;
  text += ' only.';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function logoSrc() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${LOGO_SRC}`;
  }
  return LOGO_SRC;
}

function partyLines(name, address, gstin, pan, state) {
  const lines = [];
  if (address) lines.push(address);
  const ids = [
    gstin ? `GSTIN ${gstin}` : null,
    pan ? `PAN ${pan}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  if (ids) lines.push(ids);
  if (state) lines.push(`State – ${state}`);
  return { name, lines };
}

function MetaRow({ label, value, bold }) {
  if (!value) return null;
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, bold ? { fontFamily: 'Helvetica-Bold' } : null]}>{value}</Text>
    </View>
  );
}

export function SalesInvoicePdfDocument({ invoice }) {
  const company = invoice?.company_snapshot || {};
  const customer = invoice?.customer_snapshot || {};
  const lines = Array.isArray(invoice?.line_items) ? invoice.line_items : [];
  const cancelled = invoice?.status === 'cancelled';
  const companyTitle = company.trade_name || company.legal_name || 'Das CNC Products Pvt Ltd';

  const cityState = [
    company.city,
    company.pincode ? `– ${company.pincode}` : null,
    company.state,
    'India',
  ]
    .filter(Boolean)
    .join(', ')
    .replace(', –', ' –');

  const gstPhone = [
    company.phone ? `Ph ${company.phone}` : null,
    company.gstin ? `GSTIN ${company.gstin}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const billState = stateName(
    invoice?.place_of_supply_state_code || customer.state_code,
    customer.state
  );
  const billTo = partyLines(
    customer.name || invoice?.customer_name || 'Customer',
    customer.billing_address || customer.official_address,
    customer.gstin,
    customer.pan_no,
    billState
  );
  const shipTo = partyLines(
    customer.name || invoice?.customer_name || 'Customer',
    customer.official_address || customer.billing_address || customer.shipping_address,
    customer.gstin,
    customer.pan_no,
    billState
  );

  const freight = Number(invoice?.freight_amount) || 0;
  const taxable = Number(invoice?.taxable_amount) || 0;
  const cgst = Number(invoice?.cgst_amount) || 0;
  const sgst = Number(invoice?.sgst_amount) || 0;
  const igst = Number(invoice?.igst_amount) || 0;
  const preRound = taxable + freight + cgst + sgst + igst;
  const storedTotal = Number(invoice?.total_amount);
  const grand = Number.isFinite(storedTotal) ? Math.round(storedTotal) : Math.round(preRound);
  const roundOff = Math.round((grand - preRound) * 100) / 100;
  const taxAmount = cgst + sgst + igst;
  const displayLines = lines.length ? lines : [{ empty: true }];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {cancelled ? <Text style={styles.watermark}>CANCELLED</Text> : null}

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={logoSrc()} style={styles.logo} />
            <View>
              <Text style={styles.companyName}>{companyTitle}</Text>
              {company.address_line1 ? <Text style={styles.addr}>{company.address_line1}</Text> : null}
              {company.address_line2 ? <Text style={styles.addr}>{company.address_line2}</Text> : null}
              {cityState ? <Text style={styles.addr}>{cityState}</Text> : null}
              {gstPhone ? <Text style={styles.addr}>{gstPhone}</Text> : null}
            </View>
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.title}>TAX INVOICE</Text>
            <View style={styles.metaTable}>
              <MetaRow label="Invoice no" value={invoice?.invoice_number || '(Draft)'} bold />
              <MetaRow label="Invoice date" value={formatPdfDate(invoice?.issued_at) || '—'} />
              <MetaRow
                label="Vendor code"
                value={customer.vendor_code || invoice?.vendor_code || null}
              />
            </View>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={[styles.partyCol, styles.partyColLeft]}>
            <Text style={styles.sectionLabel}>BILL TO PARTY</Text>
            <Text style={styles.partyName}>{billTo.name}</Text>
            {billTo.lines.map((line, i) => (
              <Text key={i} style={styles.body}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.partyCol}>
            <Text style={styles.sectionLabel}>SHIP TO PARTY</Text>
            <Text style={styles.partyName}>{shipTo.name}</Text>
            {shipTo.lines.map((line, i) => (
              <Text key={i} style={styles.body}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.thText, styles.cSl]}>SL</Text>
            <Text style={[styles.thText, styles.cPo]}>PO ref</Text>
            <Text style={[styles.thText, styles.cHsn]}>HSN</Text>
            <Text style={[styles.thText, styles.cDesc]}>Description</Text>
            <Text style={[styles.thText, styles.cPkg]}>Package</Text>
            <Text style={[styles.thText, styles.cQty]}>Qty</Text>
            <Text style={[styles.thText, styles.cRate]}>Rate</Text>
            <Text style={[styles.thText, styles.cAmt]}>Amount</Text>
          </View>
          {displayLines.map((line, idx) => {
            const poRef = line.empty
              ? '—'
              : line.po_ref || invoice?.blanket_number || '—';
            const poDate = line.empty
              ? null
              : formatPdfDate(line.po_date || invoice?.blanket_created_at);
            return (
              <View key={idx} style={styles.tr} wrap={false}>
                <Text style={[styles.tdMuted, styles.cSl]}>{line.empty ? '—' : idx + 1}</Text>
                <View style={styles.cPo}>
                  <Text style={styles.td}>{poRef}</Text>
                  {poDate ? <Text style={styles.tdSub}>{poDate}</Text> : null}
                </View>
                <Text style={[styles.td, styles.cHsn]}>{line.empty ? '—' : line.hsn || '—'}</Text>
                <Text style={[styles.td, styles.cDesc]}>
                  {line.empty ? '—' : line.description || 'Item'}
                </Text>
                <Text style={[styles.td, styles.cPkg]}>{line.empty ? '—' : line.package || '—'}</Text>
                <Text style={[styles.td, styles.cQty]}>{line.empty ? '—' : qtyLabel(line)}</Text>
                <Text style={[styles.td, styles.cRate]}>
                  {line.empty ? '—' : money(line.unit_price)}
                </Text>
                <Text style={[styles.td, styles.cAmt, { fontFamily: 'Helvetica-Bold' }]}>
                  {line.empty ? '—' : money(line.taxable_amount)}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.tableRule} />

        <View style={styles.totalsWrap}>
          <View style={styles.wordsCol}>
            <Text style={styles.wordsLabel}>AMOUNT IN WORDS</Text>
            <Text style={styles.wordsText}>Tax: {rupeesInWords(taxAmount)}</Text>
            <Text style={styles.wordsText}>Total: {rupeesInWords(grand)}</Text>
            {invoice?.payment_terms ? (
              <Text style={styles.paymentTerms}>Payment terms  ·  {invoice.payment_terms}</Text>
            ) : null}
          </View>
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total value</Text>
              <Text style={styles.totalValue}>{money(taxable)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Freight / P&F</Text>
              <Text style={styles.totalValue}>{money(freight)}</Text>
            </View>
            {invoice?.tax_type === 'IGST' ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>IGST (18%)</Text>
                <Text style={styles.totalValue}>{money(igst)}</Text>
              </View>
            ) : (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>CGST (9%)</Text>
                  <Text style={styles.totalValue}>{money(cgst)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>SGST (9%)</Text>
                  <Text style={styles.totalValue}>{money(sgst)}</Text>
                </View>
              </>
            )}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Round off</Text>
              <Text style={styles.totalValue}>
                {roundOff < 0 ? `–${money(Math.abs(roundOff))}` : money(roundOff)}
              </Text>
            </View>
            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Grand total</Text>
              <Text style={styles.grandValue}>{money(grand)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.certify}>
          Certified that the particulars given above are true and correct, and that the amount
          indicated represents the price actually charged with no additional consideration, directly
          or indirectly, from the buyer.
        </Text>

        <View style={styles.signs}>
          <View style={styles.signCol}>
            <Text style={styles.signHint}>Received the above goods in good condition</Text>
            <View style={styles.signSpace} />
            <View style={styles.signLine}>
              <Text style={styles.signCaption}>Sign. with seal</Text>
            </View>
          </View>
          <View style={styles.signColRight}>
            <Text style={styles.signHint}>For {companyTitle}</Text>
            <View style={styles.signSpace} />
            <View style={styles.signLine}>
              <Text style={[styles.signCaption, { textAlign: 'right' }]}>Authorised signatory</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export default SalesInvoicePdfDocument;
