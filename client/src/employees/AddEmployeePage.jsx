import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import api from '../api/client';
import FormSearchSelect from '../components/shared/FormSearchSelect';
import { AlertBanner, FilePicker, PageHeader } from '../components/mes';

const STEPS = [
  { id: 1, title: 'Profile', hint: 'Code, role & assignment' },
  { id: 2, title: 'Documents', hint: 'ID proofs & records' },
  { id: 3, title: 'Address', hint: 'Temporary & permanent' },
  { id: 4, title: 'Commercials', hint: 'Bank & compensation' },
];

const JOB_DESCRIPTION_OPTIONS = [
  { value: 'OPERATOR', label: 'Operator' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Admin' },
];

const DOCUMENT_FIELDS = [
  { id: 'aadhar', label: 'Aadhar card', hint: 'Image or PDF' },
  { id: 'marks_card', label: 'Marks card', hint: 'Image or PDF' },
  { id: 'work_experience', label: 'Work experience', hint: 'Image or PDF' },
  { id: 'thumb_impression', label: 'Thumb impression', hint: 'Image' },
];

function formatCurrency(value) {
  if (value === '' || value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN')}/mo`;
}

export default function AddEmployeePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const [photo, setPhoto] = useState(null);
  const [aadharFile, setAadharFile] = useState(null);
  const [marksCardFile, setMarksCardFile] = useState(null);
  const [workExperienceFile, setWorkExperienceFile] = useState(null);
  const [thumbFile, setThumbFile] = useState(null);

  const [formData, setFormData] = useState({
    employee_code: '',
    full_name: '',
    job_description: 'OPERATOR',
    department_id: '',
    shift_id: '',
    password: '',
    temporary_address: '',
    permanent_address: '',
    bank_name: '',
    bank_account_number: '',
    ifsc: '',
    ESI_no: '',
    basic_salary: '',
    allowance: '',
    PA: '',
    PT: '',
  });

  useEffect(() => {
    let mounted = true;

    async function loadDependencies() {
      try {
        setLoading(true);
        const [deptRes, shiftsRes] = await Promise.all([
          api.get('/employees/departments'),
          api.get('/employees/shifts'),
        ]);
        if (!mounted) return;
        setDepartments(deptRes.data.departments || []);
        setShifts(shiftsRes.data.shifts || []);
      } catch (err) {
        console.error('Failed to load departments/shifts:', err);
        if (!mounted) return;
        setError('Unable to load departments and shifts.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadDependencies();
    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const setFieldValue = (name) => (value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const departmentOptions = departments.map((dept) => ({ value: dept.id, label: dept.name }));
  const shiftOptions = shifts.map((shift) => ({ value: shift.id, label: shift.name }));

  const departmentName = useMemo(
    () => departments.find((d) => String(d.id) === String(formData.department_id))?.name || '',
    [departments, formData.department_id]
  );

  const shiftName = useMemo(
    () => shifts.find((s) => String(s.id) === String(formData.shift_id))?.name || '',
    [shifts, formData.shift_id]
  );

  const jobLabel = useMemo(
    () => JOB_DESCRIPTION_OPTIONS.find((o) => o.value === formData.job_description)?.label || '',
    [formData.job_description]
  );

  const documentFiles = useMemo(
    () => ({
      aadhar: aadharFile,
      marks_card: marksCardFile,
      work_experience: workExperienceFile,
      thumb_impression: thumbFile,
    }),
    [aadharFile, marksCardFile, workExperienceFile, thumbFile]
  );

  const uploadedDocCount = useMemo(
    () => Object.values(documentFiles).filter(Boolean).length,
    [documentFiles]
  );

  function setDocumentFile(id, file) {
    if (id === 'aadhar') setAadharFile(file);
    else if (id === 'marks_card') setMarksCardFile(file);
    else if (id === 'work_experience') setWorkExperienceFile(file);
    else if (id === 'thumb_impression') setThumbFile(file);
  }

  function canNext() {
    if (step === 1) {
      return (
        Boolean(formData.employee_code.trim()) &&
        Boolean(formData.full_name.trim()) &&
        Boolean(formData.job_description)
      );
    }
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    try {
      const payload = new FormData();
      payload.append('employee_code', formData.employee_code.trim());
      payload.append('full_name', formData.full_name.trim());
      payload.append('job_description', formData.job_description);
      payload.append('department_id', formData.department_id || '');
      payload.append('shift_id', formData.shift_id || '');
      payload.append('password', formData.password || '');
      payload.append('temporary_address', formData.temporary_address || '');
      payload.append('permanent_address', formData.permanent_address || '');
      payload.append('bank_name', formData.bank_name || '');
      payload.append('bank_account_number', formData.bank_account_number || '');
      payload.append('ifsc', formData.ifsc || '');
      payload.append('ESI_no', formData.ESI_no || '');
      payload.append('basic_salary', formData.basic_salary || '');
      payload.append('allowance', formData.allowance || '');
      payload.append('PA', formData.PA || '');
      payload.append('PT', formData.PT || '');

      if (photo) payload.append('photo', photo);
      if (aadharFile) payload.append('aadhar', aadharFile);
      if (marksCardFile) payload.append('marks_card', marksCardFile);
      if (workExperienceFile) payload.append('work_experience', workExperienceFile);
      if (thumbFile) payload.append('thumb_impression', thumbFile);

      const { data } = await api.post('/employees', payload);
      const newId = data?.employee?.id;
      navigate(newId ? `/employees/${newId}` : '/employees');
    } catch (err) {
      console.error('Failed to create employee:', err);
      setError(err.response?.data?.error || 'Unable to create employee. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mes-shell bpo-setup-page">
      <PageHeader
        eyebrow="Workforce"
        title="Add employee"
        subtitle="Set up profile, upload documents, add address and bank details in a few guided steps."
      />

      <nav className="bpo-steps" aria-label="Setup steps">
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`bpo-step${step === s.id ? ' is-active' : ''}${step > s.id ? ' is-done' : ''}`}
            onClick={() => {
              if (s.id < step || (s.id === step + 1 && canNext())) setStep(s.id);
            }}
            disabled={s.id > step + 1 || (s.id > step && !canNext())}
          >
            <span className="bpo-step-num">
              {step > s.id ? <Check size={14} strokeWidth={3} /> : s.id}
            </span>
            <span className="bpo-step-text">
              <strong>{s.title}</strong>
              <small>{s.hint}</small>
            </span>
          </button>
        ))}
      </nav>

      <section className="card bpo-setup-card">
        {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

        {step === 1 ? (
          <div className="bpo-panel">
            <h2>Employee profile</h2>
            <p className="muted bpo-lead">Core identity, role assignment, and login credentials.</p>

            <div className="bpo-grid-2">
              <label htmlFor="employee_code">
                Employee code <span className="req">*</span>
                <input
                  id="employee_code"
                  type="text"
                  name="employee_code"
                  value={formData.employee_code}
                  onChange={handleChange}
                  placeholder="e.g. DAS001"
                  required
                  disabled={submitting}
                />
              </label>

              <label htmlFor="full_name">
                Full name <span className="req">*</span>
                <input
                  id="full_name"
                  type="text"
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleChange}
                  placeholder="e.g. John Doe"
                  required
                  disabled={submitting}
                />
              </label>
            </div>

            <div className="bpo-grid-2">
              <label htmlFor="job_description">
                Job description <span className="req">*</span>
                <FormSearchSelect
                  value={formData.job_description}
                  onChange={setFieldValue('job_description')}
                  options={JOB_DESCRIPTION_OPTIONS}
                  placeholder="Select a role"
                  disabled={submitting}
                  clearable={false}
                />
              </label>

              <label htmlFor="password">
                Password
                <input
                  id="password"
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Leave blank to auto-generate"
                  disabled={submitting}
                />
              </label>
            </div>

            <div className="bpo-grid-2">
              <label htmlFor="department_id">
                Department
                <FormSearchSelect
                  value={formData.department_id}
                  onChange={setFieldValue('department_id')}
                  options={departmentOptions}
                  placeholder="Select a department"
                  disabled={submitting || loading}
                  searchable={departmentOptions.length > 6}
                />
              </label>

              <label htmlFor="shift_id">
                Shift
                <FormSearchSelect
                  value={formData.shift_id}
                  onChange={setFieldValue('shift_id')}
                  options={shiftOptions}
                  placeholder="Select a shift"
                  disabled={submitting || loading}
                  searchable={shiftOptions.length > 6}
                />
              </label>
            </div>

            <label htmlFor="photo">
              Photo
              <FilePicker
                id="photo"
                accept="image/*"
                disabled={submitting}
                fileName={photo?.name}
                label={photo ? 'Replace photo' : 'Choose photo'}
                onChange={setPhoto}
              />
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="bpo-panel">
            <h2>Documents</h2>
            <p className="muted bpo-lead">
              Upload identity proofs and records. All fields are optional — you can add them later from the employee profile.
            </p>

            <div className="bpo-grid-2">
              {DOCUMENT_FIELDS.map(({ id, label, hint }) => (
                <label key={id}>
                  {label}
                  <small className="muted" style={{ display: 'block', marginBottom: 6 }}>
                    {hint}
                  </small>
                  <FilePicker
                    accept={id === 'thumb_impression' ? 'image/*' : 'image/*,application/pdf'}
                    disabled={submitting}
                    fileName={documentFiles[id]?.name}
                    label={documentFiles[id] ? 'Replace file' : 'Choose file'}
                    onChange={(file) => setDocumentFile(id, file)}
                  />
                </label>
              ))}
            </div>

            {uploadedDocCount > 0 ? (
              <div className="bpo-summary-chip">
                {uploadedDocCount} document{uploadedDocCount === 1 ? '' : 's'} ready to upload
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="bpo-panel">
            <h2>Address</h2>
            <p className="muted bpo-lead">Temporary and permanent addresses for records and correspondence.</p>

            <label htmlFor="temporary_address">
              Temporary address
              <textarea
                id="temporary_address"
                name="temporary_address"
                value={formData.temporary_address}
                onChange={handleChange}
                disabled={submitting}
                rows={4}
                placeholder="Current / local address"
              />
            </label>

            <label htmlFor="permanent_address">
              Permanent address
              <textarea
                id="permanent_address"
                name="permanent_address"
                value={formData.permanent_address}
                onChange={handleChange}
                disabled={submitting}
                rows={4}
                placeholder="Permanent / home address"
              />
            </label>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="bpo-panel">
            <h2>Bank & compensation</h2>
            <p className="muted bpo-lead">Payroll bank details and monthly compensation components.</p>

            <p className="form-page-section-title">Bank details</p>
            <div className="bpo-grid-2">
              <label htmlFor="bank_name">
                Bank name
                <input
                  id="bank_name"
                  type="text"
                  name="bank_name"
                  value={formData.bank_name}
                  onChange={handleChange}
                  disabled={submitting}
                />
              </label>

              <label htmlFor="bank_account_number">
                Account number
                <input
                  id="bank_account_number"
                  type="text"
                  name="bank_account_number"
                  value={formData.bank_account_number}
                  onChange={handleChange}
                  disabled={submitting}
                />
              </label>

              <label htmlFor="ifsc">
                IFSC code
                <input
                  id="ifsc"
                  type="text"
                  name="ifsc"
                  value={formData.ifsc}
                  onChange={handleChange}
                  disabled={submitting}
                />
              </label>

              <label htmlFor="esi_no">
                ESI number
                <input
                  id="esi_no"
                  type="text"
                  name="ESI_no"
                  value={formData.ESI_no}
                  onChange={handleChange}
                  disabled={submitting}
                />
              </label>
            </div>

            <p className="form-page-section-title">Compensation</p>
            <div className="bpo-grid-2">
              <label htmlFor="basic_salary">
                Basic salary (₹/mo)
                <input
                  id="basic_salary"
                  type="number"
                  name="basic_salary"
                  value={formData.basic_salary}
                  onChange={handleChange}
                  disabled={submitting}
                  min="0"
                  step="any"
                />
              </label>

              <label htmlFor="allowance">
                Allowance (₹/mo)
                <input
                  id="allowance"
                  type="number"
                  name="allowance"
                  value={formData.allowance}
                  onChange={handleChange}
                  disabled={submitting}
                  min="0"
                  step="any"
                />
              </label>

              <label htmlFor="PA">
                PA — personal allowance (₹/mo)
                <input
                  id="PA"
                  type="number"
                  name="PA"
                  value={formData.PA}
                  onChange={handleChange}
                  disabled={submitting}
                  min="0"
                  step="any"
                />
              </label>

              <label htmlFor="PT">
                PT — professional tax (₹/mo)
                <input
                  id="PT"
                  type="number"
                  name="PT"
                  value={formData.PT}
                  onChange={handleChange}
                  disabled={submitting}
                  min="0"
                  step="any"
                />
              </label>
            </div>

            <div className="bpo-review">
              <h3>Review</h3>
              <ul>
                <li>
                  <span>Employee</span>
                  <strong>
                    {formData.employee_code.trim() || '—'} · {formData.full_name.trim() || '—'}
                  </strong>
                </li>
                <li>
                  <span>Role</span>
                  <strong>
                    {jobLabel}
                    {departmentName ? ` · ${departmentName}` : ''}
                    {shiftName ? ` · ${shiftName}` : ''}
                  </strong>
                </li>
                <li>
                  <span>Documents</span>
                  <strong>
                    {uploadedDocCount > 0
                      ? `${uploadedDocCount} file${uploadedDocCount === 1 ? '' : 's'}`
                      : 'None attached'}
                    {photo ? ' + photo' : ''}
                  </strong>
                </li>
                <li>
                  <span>Address</span>
                  <strong>
                    {formData.temporary_address.trim() || formData.permanent_address.trim()
                      ? 'Provided'
                      : 'Not set'}
                  </strong>
                </li>
                <li>
                  <span>Bank</span>
                  <strong>
                    {formData.bank_name.trim() || formData.bank_account_number.trim()
                      ? formData.bank_name.trim() || 'Account on file'
                      : 'Not set'}
                  </strong>
                </li>
                <li>
                  <span>Compensation</span>
                  <strong>
                    {formData.basic_salary !== ''
                      ? formatCurrency(formData.basic_salary)
                      : 'Not set'}
                  </strong>
                </li>
              </ul>
            </div>
          </div>
        ) : null}

        <div className="bpo-footer">
          {step > 1 ? (
            <button
              type="button"
              className="neutral-button"
              disabled={submitting}
              onClick={() => setStep((s) => s - 1)}
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              className="cancel-button"
              disabled={submitting}
              onClick={() => navigate('/employees')}
            >
              Cancel
            </button>
          )}

          {step < 4 ? (
            <button
              type="button"
              className="primary-button"
              disabled={submitting || !canNext()}
              onClick={() => setStep((s) => s + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={submitting || !canNext()}
              onClick={handleSubmit}
            >
              {submitting ? 'Creating…' : 'Create employee'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
