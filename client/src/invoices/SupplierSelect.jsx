import { useEffect, useState } from 'react';
import api from '../api/client';
import FormSearchSelect from '../components/shared/FormSearchSelect';

export default function SupplierSelect({
  value,
  label = '',
  onChange,
  disabled = false,
  placeholder = 'Search supplier…',
}) {
  const [options, setOptions] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get('/suppliers/lookup', { params: { search: search.trim() } })
        .then(({ data }) => {
          if (cancelled) return;
          const rows = Array.isArray(data?.results) ? data.results : [];
          setOptions(rows.map((row) => ({ value: row.id, label: row.label || row.name })));
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  return (
    <FormSearchSelect
      value={value || ''}
      selectedLabel={label}
      onChange={(next) => {
        const match = options.find((o) => String(o.value) === String(next));
        onChange({ id: next || '', label: match?.label || label || '' });
      }}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      searchable
      search={search}
      onSearchChange={setSearch}
      loading={loading}
      emptyMessage="No suppliers found"
      className="form-search-select"
    />
  );
}
