import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import FormSearchSelect from '../components/shared/FormSearchSelect';

export default function EmployeeSelect({ value, onChange, disabled = false }) {
  const [employees, setEmployees] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api
      .get('/employees')
      .then(({ data }) => {
        if (!mounted) return;
        setEmployees(data.employees || []);
      })
      .catch((err) => console.error('Failed to load employees:', err))
      .finally(() => {
        if (mounted) setInitialLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const fetchOptions = useCallback(async (search) => {
    const query = search.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter((employee) =>
      [employee.full_name, employee.employee_code, employee.department, employee.job_description]
        .join(' ')
        .toLowerCase()
        .includes(query)
    );
  }, [employees]);

  const selected = employees.find((employee) => String(employee.id) === String(value));
  const selectedLabel = selected
    ? `${selected.full_name}${selected.employee_code ? ` (${selected.employee_code})` : ''}`
    : '';

  return (
    <FormSearchSelect
      value={value}
      selectedLabel={selectedLabel}
      placeholder={initialLoading ? 'Loading employees…' : 'Select employee…'}
      disabled={disabled || initialLoading}
      fetchOptions={fetchOptions}
      emptyMessage="No employees found."
      mapOption={(employee) => ({
        id: employee.id,
        value: employee.id,
        label: `${employee.full_name}${employee.employee_code ? ` (${employee.employee_code})` : ''}`,
      })}
      onChange={(id) => onChange(id)}
    />
  );
}
