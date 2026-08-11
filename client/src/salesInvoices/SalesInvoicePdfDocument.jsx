import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1a1a1a',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    borderBottomWidth: 1.5,
    borderBottomColor: '#111',
    paddingBottom: 12,
  },
  companyName: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  muted: { color: '#555', marginBottom: 2 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  badge: {
    marginTop: 6,
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  section: { marginTop: 14, marginBottom: 6 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  col: { flex: 1 },
  table: { marginTop: 12, borderWidth: 1, borderColor: '#ccc' },
  th: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  cDesc: { flex: 3 },
  cQty: { flex: 1, textAlign: 'right' },
  cRate: { flex: 1.2, textAlign: 'right' },
  cAmt: { flex: 1.3, textAlign: 'right' },
  totals: { marginTop: 12, alignSelf: 'flex-end', width: 220 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalStrong: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#111',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  watermark: {
    position: 'absolute',
    top: '40%',
    left: '18%',
    fontSize: 48,
    color: '#dc2626',
    opacity: 0.18,
    transform: 'rotate(-30deg)',
    fontFamily: 'Helvetica-Bold',
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    paddingTop: 8,
    fontSize: 8,
    color: '#666',
  },
});

function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addrLines(company) {
  return [
    company?.address_line1,
    company?.address_line2,
    [company?.city, company?.state].filter(Boolean).join(', '),
    company?.gstin ? `GSTIN: ${company.gstin}` : null,
    company?.pan ? `PAN: ${company.pan}` : null,
  ].filter(Boolean);
}

export function SalesInvoicePdfDocument({ invoice }) {
  const company = invoice?.company_snapshot || {};
  const customer = invoice?.customer_snapshot || {};
  const lines = invoice?.line_items || [];
  const cancelled = invoice?.status === 'cancelled';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {cancelled ? <Text style={styles.watermark}>CANCELLED</Text> : null}

        <View style={styles.headerRow}>
          <View style={{ flex: 1.4 }}>
            <Text style={styles.companyName}>
              {company.trade_name || company.legal_name || 'Company'}
            </Text>
            {company.legal_name && company.trade_name !== company.legal_name ? (
              <Text style={styles.muted}>{company.legal_name}</Text>
            ) : null}
            {addrLines(company).map((line) => (
              <Text key={line} style={styles.muted}>
                {line}
              </Text>
            ))}
            {company.phone ? <Text style={styles.muted}>Ph: {company.phone}</Text> : null}
            {company.email ? <Text style={styles.muted}>{company.email}</Text> : null}
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={styles.title}>TAX INVOICE</Text>
            <Text style={styles.muted}>
              No: {invoice?.invoice_number || '(Draft)'}
            </Text>
            <Text style={styles.muted}>
              Date:{' '}
              {invoice?.issued_at
                ? new Date(invoice.issued_at).toLocaleDateString('en-IN')
                : '—'}
            </Text>
            {invoice?.due_date ? (
              <Text style={styles.muted}>Due: {invoice.due_date}</Text>
            ) : null}
            <Text
              style={[
                styles.badge,
                {
                  backgroundColor:
                    invoice?.status === 'paid'
                      ? '#dcfce7'
                      : invoice?.status === 'cancelled'
                        ? '#fee2e2'
                        : '#ffedd5',
                  color:
                    invoice?.status === 'paid'
                      ? '#166534'
                      : invoice?.status === 'cancelled'
                        ? '#991b1b'
                        : '#9a3412',
                },
              ]}
            >
              {(invoice?.status || 'draft').toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Bill to</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>
              {customer.name || invoice?.customer_name || 'Customer'}
            </Text>
            {customer.billing_address || customer.official_address ? (
              <Text style={styles.muted}>
                {customer.billing_address || customer.official_address}
              </Text>
            ) : null}
            {customer.gstin ? (
              <Text style={styles.muted}>GSTIN: {customer.gstin}</Text>
            ) : null}
            {invoice?.place_of_supply_state_code ? (
              <Text style={styles.muted}>
                Place of supply: {invoice.place_of_supply_state_code}
              </Text>
            ) : null}
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>References</Text>
            {invoice?.lot_number ? (
              <Text style={styles.muted}>Lot: {invoice.lot_number}</Text>
            ) : null}
            {lines[0]?.schedule_number ? (
              <Text style={styles.muted}>Schedule: {lines[0].schedule_number}</Text>
            ) : null}
            {invoice?.payment_terms ? (
              <Text style={styles.muted}>Terms: {invoice.payment_terms}</Text>
            ) : null}
            <Text style={styles.muted}>
              Tax: {invoice?.tax_type === 'IGST' ? 'IGST 18%' : 'CGST 9% + SGST 9%'}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cDesc}>Description</Text>
            <Text style={styles.cQty}>Qty</Text>
            <Text style={styles.cRate}>Rate</Text>
            <Text style={styles.cAmt}>Amount</Text>
          </View>
          {lines.map((line, idx) => (
            <View key={idx} style={styles.tr}>
              <Text style={styles.cDesc}>{line.description || 'Item'}</Text>
              <Text style={styles.cQty}>
                {line.quantity}
                {line.uom ? ` ${line.uom}` : ''}
              </Text>
              <Text style={styles.cRate}>{money(line.unit_price)}</Text>
              <Text style={styles.cAmt}>{money(line.taxable_amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Taxable</Text>
            <Text>{money(invoice?.taxable_amount)}</Text>
          </View>
          {invoice?.tax_type === 'IGST' ? (
            <View style={styles.totalRow}>
              <Text>IGST (18%)</Text>
              <Text>{money(invoice?.igst_amount)}</Text>
            </View>
          ) : (
            <>
              <View style={styles.totalRow}>
                <Text>CGST (9%)</Text>
                <Text>{money(invoice?.cgst_amount)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text>SGST (9%)</Text>
                <Text>{money(invoice?.sgst_amount)}</Text>
              </View>
            </>
          )}
          <View style={styles.totalStrong}>
            <Text>Total (INR)</Text>
            <Text>{money(invoice?.total_amount)}</Text>
          </View>
        </View>

        {(company.bank_name || company.bank_account || company.ifsc) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Bank details</Text>
            {company.bank_name ? <Text style={styles.muted}>{company.bank_name}</Text> : null}
            {company.bank_account ? (
              <Text style={styles.muted}>A/c: {company.bank_account}</Text>
            ) : null}
            {company.ifsc ? <Text style={styles.muted}>IFSC: {company.ifsc}</Text> : null}
          </View>
        )}

        {invoice?.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.muted}>{invoice.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text>
            This is a computer-generated tax invoice. Cancelled numbers are retained for GST
            compliance.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export default SalesInvoicePdfDocument;
