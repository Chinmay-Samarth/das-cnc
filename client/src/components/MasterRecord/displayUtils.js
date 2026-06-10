import api from '../../api/client';
import { formatDate, operatorLabel } from '../MasterBuilder/utils';

export function getRecordValueRow(record, fieldId) {
  return (record?.record_values || []).find((item) => item.field_id === fieldId);
}

export function formatRecordLabel(record) {
  if (!record?.name) return '—';
  return record.code ? `${record.name} (${record.code})` : record.name;
}

export function formatPreviewFieldValue(field, valueRow, relatedRecordNames = {}) {
  if (!valueRow) return '—';

  if (field.type === 'image') {
    return valueRow.image_url ? 'Image' : '—';
  }

  if (field.type === 'relation') {
    const relatedId = valueRow.related_record_id;
    if (!relatedId) return '—';
    return relatedRecordNames[relatedId] || '—';
  }

  if (field.type === 'date') {
    return formatDate(valueRow.value);
  }

  return valueRow.value ?? '—';
}

export function formatRecordFieldValue(field, valueRow, relatedRecordNames = {}) {
  if (!valueRow) return { kind: 'text', text: '—' };

  if (field.type === 'image') {
    if (!valueRow.image_url) return { kind: 'text', text: '—' };
    return { kind: 'image', url: valueRow.image_url, alt: field.label || 'Field image' };
  }

  if (field.type === 'relation') {
    const relatedId = valueRow.related_record_id;
    if (!relatedId) return { kind: 'text', text: '—' };
    return { kind: 'text', text: relatedRecordNames[relatedId] || relatedId };
  }

  if (field.type === 'date') {
    return { kind: 'text', text: formatDate(valueRow.value) };
  }

  return { kind: 'text', text: valueRow.value ?? '—' };
}

async function fetchRelatedRecordNames(idsByMaster) {
  const names = {};

  await Promise.all(
    Object.entries(idsByMaster).map(async ([relatedMasterId, ids]) => {
      try {
        const { data } = await api.get(`/masters/${relatedMasterId}/records`);
        (data.records || []).forEach((item) => {
          if (ids.has(item.id)) {
            names[item.id] = formatRecordLabel(item);
          }
        });
      } catch (err) {
        console.error('Failed to load related record names:', err);
      }
    })
  );

  return names;
}

function collectRelatedRecordIds(master, records, fields = null) {
  const allFields = fields || master?.master_fields || [];
  const relationFields = allFields.filter((field) => field.type === 'relation' && field.related_master_id);
  const idsByMaster = {};

  records.forEach((record) => {
    const values = record.record_values || [];
    relationFields.forEach((field) => {
      const valueRow = values.find((item) => item.field_id === field.id);
      if (!valueRow?.related_record_id) return;

      if (!idsByMaster[field.related_master_id]) {
        idsByMaster[field.related_master_id] = new Set();
      }
      idsByMaster[field.related_master_id].add(valueRow.related_record_id);
    });
  });

  return idsByMaster;
}

export async function loadRelatedRecordNames(master, record) {
  const idsByMaster = collectRelatedRecordIds(master, [record]);
  return fetchRelatedRecordNames(idsByMaster);
}

export async function loadRelatedRecordNamesBatch(master, records, fields = null) {
  const idsByMaster = collectRelatedRecordIds(master, records, fields);
  return fetchRelatedRecordNames(idsByMaster);
}

export function formatRuleCondition(rule, fields) {
  const conditionField = fields.find((field) => field.id === rule.condition_field_id);
  const thresholdField = fields.find((field) => field.id === rule.threshold_field_id);
  const conditionLabel = conditionField?.label || conditionField?.field_key || 'Field';
  const operator = operatorLabel(rule.operator);
  const compareTarget = thresholdField
    ? thresholdField.label || thresholdField.field_key
    : rule.threshold_value ?? '—';

  return `${conditionLabel} ${operator} ${compareTarget}`;
}
