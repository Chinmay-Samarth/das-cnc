import { useCallback, useMemo, useState } from 'react';
import api from '../api/client';
import { appAlert } from '../components/dialog';
import FormSearchSelect from '../components/shared/FormSearchSelect';
import { getCategoryConfig } from './girnCategoryConfig';

function cellValue(flat, sectionSlug, fieldSlug) {
  return flat?.[sectionSlug]?.[fieldSlug]?.value ?? null;
}

function findFieldValue(flat, sections, matchers) {
  for (const section of sections || []) {
    for (const field of section.fields || []) {
      const slug = field.slug.toLowerCase();
      const label = field.label.toLowerCase();
      const matched = matchers.some(
        (m) => slug === m || slug.includes(m) || label.includes(m)
      );
      if (matched) {
        const val = cellValue(flat, section.slug, field.slug);
        if (val != null && String(val).trim() !== '') return String(val).trim();
      }
    }
  }
  return null;
}

export function mapMasterRecord(flat, sections, category, lookupLabel = '') {
  const cfg = getCategoryConfig(category);
  const keyMatchers = cfg.keyFieldMatchers || ['code', 'id'];
  const codeMatchers = cfg.codeFieldMatchers || ['code'];

  const itemCode =
    findFieldValue(flat, sections, keyMatchers) ||
    lookupLabel ||
    '';

  return {
    item_code: itemCode,
    rm_id: itemCode,
    rm_code:
      findFieldValue(flat, sections, codeMatchers) ||
      '',
    grade: findFieldValue(flat, sections, ['grade']) || '',
    unit: findFieldValue(flat, sections, ['unit', 'uom']) || '',
    inventory_number:
      findFieldValue(flat, sections, ['inventory-number', 'inventory_number', 'inventory-no', 'inventory']) ||
      '',
    item_description:
      findFieldValue(flat, sections, ['description', 'name']) || '',
  };
}

export async function fetchMasterRecordDetails(masterSlug, recordId, category) {
  const [schemaRes, recordRes] = await Promise.all([
    api.get(`/masters/${masterSlug}/schema`),
    api.get(`/masters/${masterSlug}/records/${recordId}`),
  ]);

  const sections = schemaRes.data?.sections || [];
  const flat = recordRes.data?.flat || {};

  return {
    sections,
    flat,
    mapped: mapMasterRecord(flat, sections, category),
  };
}

export default function MasterItemSelect({
  masterSlug,
  category = 'raw_material',
  value,
  label = '',
  onChange,
  disabled = false,
  placeholder,
  filterParams,
}) {
  const [busy, setBusy] = useState(false);
  const cfg = getCategoryConfig(category);
  const defaultPlaceholder = placeholder || `Search ${cfg.label.toLowerCase()}…`;

  const fetchOptions = useCallback(
    async (search) => {
      if (!masterSlug) return [];
      const { data } = await api.get(`/masters/${masterSlug}/lookup`, {
        params: { search: search.trim(), ...(filterParams || {}) },
      });
      return data || [];
    },
    [filterParams, masterSlug]
  );

  const mapOption = useCallback(
    (option) => ({
      value: option.record_id,
      label: option.label,
      title: option.label,
      subtitle: `${cfg.label} master record`,
      raw: option,
    }),
    [cfg.label]
  );

  const selectedLabel = useMemo(() => {
    if (label) return label;
    if (value) return `Linked ${cfg.label.toLowerCase()}`;
    return '';
  }, [cfg.label, label, value]);

  async function handleChange(nextId, raw) {
    if (!nextId) {
      onChange({
        master_record_id: null,
        master_record_label: '',
        raw_material_id: null,
        raw_material_label: '',
        item_code: '',
        rm_id: '',
        rm_code: '',
        grade: '',
        unit: '',
        inventory_number: '',
        item_description: '',
      });
      return;
    }

    try {
      setBusy(true);
      const option = raw?.raw || raw || {};
      const { mapped } = await fetchMasterRecordDetails(masterSlug, nextId, category);
      onChange({
        master_record_id: nextId,
        master_record_label: option.label || label || '',
        raw_material_id: category === 'raw_material' ? nextId : null,
        raw_material_label: category === 'raw_material' ? option.label || label || '' : '',
        ...mapped,
      });
    } catch (err) {
      console.error('Failed to load master record:', err);
      await appAlert({
        title: 'Unable to load item',
        message: err.response?.data?.error || 'Unable to load item details.',
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSearchSelect
      value={value || ''}
      selectedLabel={selectedLabel}
      onChange={handleChange}
      fetchOptions={fetchOptions}
      mapOption={mapOption}
      placeholder={defaultPlaceholder}
      disabled={disabled || !masterSlug || busy}
      loading={busy}
      emptyMessage="No matching master records. Create the item in masters first."
      portal
    />
  );
}
