import { useCallback } from 'react';
import api from '../api/client';
import FormSearchSelect from '../components/shared/FormSearchSelect';

/** Searchable component picker for blanket PO setup */
export default function ComponentSelect({
  value,
  label = '',
  onChange,
  disabled = false,
  placeholder = 'Search component…',
}) {
  const fetchOptions = useCallback(async (search) => {
    const { data } = await api.get('/masters/component/lookup', { params: { search } });
    return Array.isArray(data) ? data : data?.results || [];
  }, []);

  return (
    <FormSearchSelect
      value={value}
      selectedLabel={label}
      placeholder={placeholder}
      disabled={disabled}
      fetchOptions={fetchOptions}
      emptyMessage="No components found."
      mapOption={(option) => {
        const id = option.record_id || option.id;
        return { id, value: id, label: option.label };
      }}
      onChange={(id, option) =>
        onChange({
          id: id || option?.record_id || option?.id || '',
          label: option?.label || '',
        })
      }
    />
  );
}
