import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { useMastersNav } from '../context/MastersNavContext';
import FieldsTab from '../components/MasterBuilder/FieldsTab';
import RulesTab from '../components/MasterBuilder/RulesTab';
import {
  emptyField,
  fieldsToPayload,
  mapFieldFromServer,
  mapRuleFromServer,
  rulesToPayload,
} from '../components/MasterBuilder/utils';

const TABS = [
  { id: 'fields', label: 'Fields' },
  { id: 'rules', label: 'Rules' },
];

export default function MasterBuilderPage() {
  const { masterId } = useParams();
  const navigate = useNavigate();
  const { refreshMasters } = useMastersNav();
  const isNew = !masterId;

  const [activeTab, setActiveTab] = useState('fields');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldsSaved, setFieldsSaved] = useState(!isNew);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [fields, setFields] = useState([]);
  const [rules, setRules] = useState([]);
  const [allMasters, setAllMasters] = useState([]);

  useEffect(() => {
    let mounted = true;

    async function loadMastersList() {
      try {
        const { data } = await api.get('/masters');
        if (mounted) setAllMasters(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load masters list:', err);
      }
    }

    loadMastersList();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (isNew) {
      setName('');
      setDescription('');
      setIcon('');
      setFields([]);
      setRules([]);
      setFieldsSaved(false);
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    async function loadMaster() {
      try {
        setLoading(true);
        setError('');
        const { data } = await api.get(`/masters/${masterId}`);
        if (!mounted) return;

        const master = data.master;
        setName(master.name || '');
        setDescription(master.description || '');
        setIcon(master.icon || '');
        setFields((master.master_fields || []).map(mapFieldFromServer));
        setRules((master.master_rules || []).map(mapRuleFromServer));
        setFieldsSaved(true);
      } catch (err) {
        console.error('Failed to load master:', err);
        if (!mounted) return;
        setError(err.response?.data?.error || 'Unable to load master.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    loadMaster();
    return () => {
      mounted = false;
    };
  }, [isNew, masterId]);

  async function handleSave() {
    if (!name.trim()) {
      setError('Master name is required.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      let savedMasterId = masterId;

      if (isNew) {
        const { data } = await api.post('/masters', {
          name: name.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
        });
        savedMasterId = data.master?.id;
        if (!savedMasterId) {
          throw new Error('Master was created but no id was returned.');
        }
      } else {
        await api.put(`/masters/${savedMasterId}`, {
          name: name.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
        });
      }

      const previousFields = fields;
      const { data: fieldsData } = await api.put(
        `/masters/${savedMasterId}/fields`,
        fieldsToPayload(fields)
      );
      const savedFields = (fieldsData.fields || []).map(mapFieldFromServer);
      setFields(savedFields);
      setFieldsSaved(true);

      const { data: rulesData } = await api.put(
        `/masters/${savedMasterId}/rules`,
        rulesToPayload(rules, savedFields, previousFields)
      );
      setRules((rulesData.rules || []).map(mapRuleFromServer));

      await refreshMasters();

      if (isNew) {
        navigate(`/masters/${savedMasterId}/configure`, { replace: true });
      }
    } catch (err) {
      console.error('Failed to save master:', err);
      setError(err.response?.data?.error || err.message || 'Unable to save master.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell master-builder-page">
      <header className="master-builder-header">
        <div className="master-builder-title-block">
          <input
            type="text"
            className="master-builder-name-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Master name"
            disabled={loading || saving}
          />
          <input
            type="text"
            className="master-builder-desc-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description (optional)"
            disabled={loading || saving}
          />
          <label className="master-builder-icon-input">
            Icon
            <input
              type="text"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              placeholder="Emoji or icon label"
              disabled={loading || saving}
            />
          </label>
        </div>

        <button type="button" className="primary-button" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <nav className="master-builder-tabs" aria-label="Master configuration sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`master-builder-tab-btn${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="card master-builder-card">
        {error ? <p className="error-message">{error}</p> : null}
        {loading ? (
          <p className="muted">Loading master…</p>
        ) : (
          <>
            {activeTab === 'fields' ? (
              <FieldsTab
                fields={fields}
                setFields={setFields}
                allMasters={allMasters}
                currentMasterId={masterId}
              />
            ) : null}
            {activeTab === 'rules' ? (
              <RulesTab
                rules={rules}
                setRules={setRules}
                fields={fields}
                fieldsSaved={fieldsSaved}
              />
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
