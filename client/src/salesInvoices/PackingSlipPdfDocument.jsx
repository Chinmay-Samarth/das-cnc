import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica-Bold',
    color: '#111111',
  },
  header: {
    alignItems: 'center',
    marginBottom: 36,
  },
  title: {
    fontSize: 16,
    marginBottom: 6,
    textAlign: 'center',
  },
  company: {
    fontSize: 13,
    marginBottom: 4,
    textAlign: 'center',
  },
  city: {
    fontSize: 13,
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  field: {
    flexDirection: 'row',
    flexShrink: 1,
    maxWidth: '62%',
  },
  fieldRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexShrink: 0,
    minWidth: '34%',
  },
  label: {
    fontSize: 12,
    marginRight: 6,
  },
  value: {
    fontSize: 12,
  },
  footer: {
    position: 'absolute',
    left: 40,
    bottom: 28,
    fontSize: 11,
  },
});

function formatSlipDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function PackingSlipPdfDocument({ invoice }) {
  const line = Array.isArray(invoice?.line_items) ? invoice.line_items[0] : null;
  const description =
    line?.description || invoice?.component_name || 'Component';
  const drawing =
    line?.drawing_number || invoice?.drawing_number || '';
  const qty = line?.quantity != null ? line.quantity : invoice?.quantity;
  const invoiceNo = invoice?.invoice_number || '';
  const date = formatSlipDate(invoice?.issued_at || invoice?.packing_slip_printed_at);

  return (
    <Document>
      <Page size="A5" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>PACKING SLIP</Text>
          <Text style={styles.company}>Das CNC Products Pvt. Ltd.,</Text>
          <Text style={styles.city}>BANGALORE-58.</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>Description :</Text>
              <Text style={styles.value}>{String(description).toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>Drg. No. :</Text>
              <Text style={styles.value}>{drawing || ''}</Text>
            </View>
            <View style={styles.fieldRight}>
              <Text style={styles.label}>Gross Weight :</Text>
              <Text style={styles.value}> </Text>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>Quantity :</Text>
              <Text style={styles.value}>{qty != null ? String(qty) : ''}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.label}>Invoice No. :</Text>
              <Text style={styles.value}>{invoiceNo}</Text>
            </View>
            <View style={styles.fieldRight}>
              <Text style={styles.label}>Date :</Text>
              <Text style={styles.value}>{date}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>QAD/F/14</Text>
      </Page>
    </Document>
  );
}

export default PackingSlipPdfDocument;
