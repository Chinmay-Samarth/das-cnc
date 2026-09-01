import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import FormSearchSelect from '../components/shared/FormSearchSelect';

/** Searchable customer picker for blanket PO setup */
export default function CustomerSelect({
  value,
  label = '',
  onChange,
  disabled = false,
  placeholder = 'Search customer…',
}) {
  const fetchOptions = useCallback(async (search) => {
    const { data } = await api.get('/customers/lookup', { params: { search } });
    return Array.isArray(data) ? data : data?.results || [];
  }, []);

  return (
    <FormSearchSelect
      value={value}
      selectedLabel={label}
      placeholder={placeholder}
      disabled={disabled}
      fetchOptions={fetchOptions}
      emptyMessage="No customers found."
      mapOption={(option) => ({ id: option.id, value: option.id, label: option.label })}
      onChange={(id, option) => onChange({ id, label: option?.label || '' })}
    />
  );
}
