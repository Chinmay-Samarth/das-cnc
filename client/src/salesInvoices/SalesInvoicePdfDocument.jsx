import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const LOGO_SRC = '/dascnclogo2.png';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 42,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
    lineHeight: 1.45,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#111111',
    paddingBottom: 14,
    marginBottom: 18,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1.35,
    paddingRight: 16,
  },
  logo: {
    width: 118,
    height: 40,
    objectFit: 'contain',
    marginRight: 12,
  },
  companyBlock: {
    flex: 1,
  },
  companyName: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    letterSpacing: 0.2,
    marginBottom: 3,
  },
  addr: {
    fontSize: 9,
    color: '#555555',
    lineHeight: 1.5,
  },

  headerRight: {
    width: 190,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.6,
    color: '#111111',
    textAlign: 'right',
  },
  meta: {
    marginTop: 6,
    fontSize: 9,
    color: '#555555',
    textAlign: 'right',
    lineHeight: 1.6,
  },
  badge: {
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.5,
    borderRadius: 3,
  },

  split: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  col: { flex: 1, paddingRight: 16 },
  colLast: { flex: 1, paddingLeft: 12 },
  sectionLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.7,
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
    fontSize: 9,
    color: '#555555',
    lineHeight: 1.5,
  },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  detailLabel: {
    fontSize: 9,
    color: '#888888',
    width: 58,
  },
  detailValue: {
    fontSize: 9,
    color: '#555555',
    flex: 1,
    textAlign: 'right',
  },

  table: {
    width: '100%',
    marginBottom: 2,
  },
  th: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f2',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#cccccc',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  thText: {
    fontSize: 9,
    color: '#444444',
    fontFamily: 'Helvetica-Bold',
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 0.5,
    borderBottomColor: '#eeeeee',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  td: {
    fontSize: 10,
    color: '#1a1a1a',
  },
  tdMuted: {
    fontSize: 10,
    color: '#666666',
  },
  tableRule: {
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    marginBottom: 16,
  },

  cIdx: { width: 22 },
  cDesc: { flex: 3.2, paddingRight: 8 },
  cQty: { width: 78, textAlign: 'right' },
  cRate: { width: 72, textAlign: 'right' },
  cAmt: { width: 78, textAlign: 'right' },

  totalsWrap: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20,
  },
  totals: {
    width: 230,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalLabel: {
    fontSize: 10,
    color: '#666666',
  },
  totalValue: {
    fontSize: 10,
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
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
  },
  grandValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
    textAlign: 'right',
  },

  notes: {
    marginBottom: 16,
  },

  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: '#dddddd',
    paddingTop: 12,
  },
  signBlock: {
    width: 160,
    alignItems: 'flex-end',
  },
  signSpace: {
    height: 34,
  },
  signLine: {
    borderTopWidth: 0.5,
    borderTopColor: '#cccccc',
    paddingTop: 4,
    minWidth: 140,
  },
  signText: {
    fontSize: 9,
    color: '#555555',
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
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 42,
    right: 42,
    borderTopWidth: 0.5,
    borderTopColor: '#eeeeee',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#999999',
    textAlign: 'center',
  },
});

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyLabel(line) {
  const n = Number(line?.quantity);
  const qty = Number.isFinite(n) ? n.toLocaleString('en-IN') : '—';
  return line?.uom ? `${qty} ${line.uom}` : qty;
}

function formatPdfDate(value) {
  if (value == null || value === '') return '—';
  const str = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) {
    return `${Number(iso[3])} ${MONTHS[Number(iso[2]) - 1]} ${iso[1]}`;
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function stateName(code, fallback) {
  const padded = String(code || '').padStart(2, '0').slice(0, 2);
  return GST_STATES[padded] || fallback || null;
}

function placeOfSupply(invoice, customer) {
  const code = invoice?.place_of_supply_state_code || customer?.state_code;
  if (!code) return null;
  const padded = String(code).padStart(2, '0').slice(0, 2);
  const name = stateName(padded, customer?.state);
  return name ? `${padded} – ${name}` : padded;
}

function logoSrc() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${LOGO_SRC}`;
  }
  return LOGO_SRC;
}

function badgeColors(status) {
  if (status === 'paid') return { backgroundColor: '#ecfdf3', color: '#166534' };
  if (status === 'cancelled') return { backgroundColor: '#fef2f2', color: '#991b1b' };
  if (status === 'due') return { backgroundColor: '#fff7ed', color: '#9a3412' };
  return { backgroundColor: '#f4f4f5', color: '#3f3f46' };
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export function SalesInvoicePdfDocument({ invoice }) {
  const company = invoice?.company_snapshot || {};
  const customer = invoice?.customer_snapshot || {};
  const lines = Array.isArray(invoice?.line_items) ? invoice.line_items : [];
  const cancelled = invoice?.status === 'cancelled';
  const companyTitle = company.trade_name || company.legal_name || 'Company';
  const cityLine = [company.city, company.state].filter(Boolean).join(', ');
  const gstPhone = [
    company.gstin ? `GSTIN ${company.gstin}` : null,
    company.phone ? `Ph ${company.phone}` : null,
  ]
    .filter(Boolean)
    .join('  |  ');

  const issuedOn = formatPdfDate(invoice?.issued_at);
  const dueOn = invoice?.due_date ? formatPdfDate(invoice.due_date) : null;
  const pos = placeOfSupply(invoice, customer);
  const taxLabel = invoice?.tax_type === 'IGST' ? 'IGST 18%' : 'CGST 9% + SGST 9%';
  const hasBank = Boolean(company.bank_name || company.bank_account || company.ifsc);
  const displayLines = lines.length ? lines : [{ empty: true }];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {cancelled ? <Text style={styles.watermark}>CANCELLED</Text> : null}

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image src={logoSrc()} style={styles.logo} />
            <View style={styles.companyBlock}>
              <Text style={styles.companyName}>{companyTitle}</Text>
              {company.legal_name && company.trade_name && company.legal_name !== company.trade_name ? (
                <Text style={styles.addr}>{company.legal_name}</Text>
              ) : null}
              {company.address_line1 ? <Text style={styles.addr}>{company.address_line1}</Text> : null}
              {company.address_line2 ? <Text style={styles.addr}>{company.address_line2}</Text> : null}
              {cityLine ? <Text style={styles.addr}>{cityLine}</Text> : null}
              {gstPhone ? <Text style={styles.addr}>{gstPhone}</Text> : null}
            </View>
          </View>

          <View style={styles.headerRight}>
            <Text style={styles.title}>TAX INVOICE</Text>
            <Text style={styles.meta}>
              No. {invoice?.invoice_number || '(Draft)'}
              {'\n'}
              Date {issuedOn}
              {dueOn ? `  ·  Due ${dueOn}` : ''}
            </Text>
            <Text style={[styles.badge, badgeColors(invoice?.status)]}>
              {(invoice?.status || 'draft').toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.split}>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>BILL TO</Text>
            <Text style={styles.partyName}>
              {customer.name || invoice?.customer_name || 'Customer'}
            </Text>
            {customer.billing_address || customer.official_address ? (
              <Text style={styles.body}>{customer.billing_address || customer.official_address}</Text>
            ) : null}
            {customer.gstin ? <Text style={styles.body}>GSTIN {customer.gstin}</Text> : null}
            {pos ? <Text style={styles.body}>Place of supply {pos}</Text> : null}
          </View>

          <View style={styles.colLast}>
            <Text style={styles.sectionLabel}>DETAILS</Text>
            <DetailRow label="Lot" value={invoice?.lot_number} />
            <DetailRow label="Schedule" value={lines[0]?.schedule_number} />
            <DetailRow label="Terms" value={invoice?.payment_terms} />
            <DetailRow label="Tax" value={taxLabel} />
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.thText, styles.cIdx]}>#</Text>
            <Text style={[styles.thText, styles.cDesc]}>Description</Text>
            <Text style={[styles.thText, styles.cQty]}>Qty</Text>
            <Text style={[styles.thText, styles.cRate]}>Rate</Text>
            <Text style={[styles.thText, styles.cAmt]}>Amount</Text>
          </View>
          {displayLines.map((line, idx) => (
            <View key={idx} style={styles.tr} wrap={false}>
              <Text style={[styles.tdMuted, styles.cIdx]}>{line.empty ? '—' : idx + 1}</Text>
              <Text style={[styles.td, styles.cDesc]}>
                {line.empty ? '—' : line.description || 'Item'}
              </Text>
              <Text style={[styles.td, styles.cQty]}>{line.empty ? '—' : qtyLabel(line)}</Text>
              <Text style={[styles.td, styles.cRate]}>{line.empty ? '—' : money(line.unit_price)}</Text>
              <Text style={[styles.td, styles.cAmt]}>{line.empty ? '—' : money(line.taxable_amount)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.tableRule} />

        <View style={styles.totalsWrap}>
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Taxable amount</Text>
              <Text style={styles.totalValue}>{money(invoice?.taxable_amount)}</Text>
            </View>
            {invoice?.tax_type === 'IGST' ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>IGST (18%)</Text>
                <Text style={styles.totalValue}>{money(invoice?.igst_amount)}</Text>
              </View>
            ) : (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>CGST (9%)</Text>
                  <Text style={styles.totalValue}>{money(invoice?.cgst_amount)}</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>SGST (9%)</Text>
                  <Text style={styles.totalValue}>{money(invoice?.sgst_amount)}</Text>
                </View>
              </>
            )}
            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Total (INR)</Text>
              <Text style={styles.grandValue}>{money(invoice?.total_amount)}</Text>
            </View>
          </View>
        </View>

        {invoice?.notes ? (
          <View style={styles.notes}>
            <Text style={styles.sectionLabel}>NOTES</Text>
            <Text style={styles.body}>{invoice.notes}</Text>
          </View>
        ) : null}

        <View style={styles.bottom}>
          <View style={styles.col}>
            {hasBank ? (
              <>
                <Text style={styles.sectionLabel}>BANK DETAILS</Text>
                {company.bank_name ? <Text style={styles.body}>{company.bank_name}</Text> : null}
                <Text style={styles.body}>
                  {[
                    company.bank_account ? `A/c ${company.bank_account}` : null,
                    company.ifsc ? `IFSC ${company.ifsc}` : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </>
            ) : null}
          </View>
          <View style={styles.signBlock}>
            <Text style={styles.sectionLabel}>AUTHORISED SIGNATORY</Text>
            <View style={styles.signSpace} />
            <View style={styles.signLine}>
              <Text style={styles.signText}>For {companyTitle}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            This is a computer-generated tax invoice. Cancelled numbers are retained for GST
            compliance.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export default SalesInvoicePdfDocument;
