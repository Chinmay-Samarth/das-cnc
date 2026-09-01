import { useCallback } from 'react';
import api from '../api/client';
import FormSearchSelect from '../components/shared/FormSearchSelect';

/**
 * Picker for unassigned machine master records.
 * Uses GET /work-centers/available-machines
 */
export default function AvailableMachineSelect({ value, label = '', onChange, disabled = false }) {
  const fetchOptions = useCallback(async (search) => {
    const { data } = await api.get('/work-centers/available-machines', {
      params: { search: search.trim() },
    });
    return data.machines || [];
  }, []);

  return (
    <FormSearchSelect
      value={value}
      selectedLabel={label}
      placeholder="Search available machines…"
      disabled={disabled}
      fetchOptions={fetchOptions}
      emptyMessage="No unassigned machines found."
      mapOption={(option) => ({
        record_id: option.record_id,
        value: option.record_id,
        label: option.label,
      })}
      onChange={(recordId, option) =>
        onChange({
          machine_record_id: recordId,
          label: option?.label || '',
        })
      }
    />
  );
}
