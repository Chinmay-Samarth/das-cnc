import { compareFields, emptyRule, fieldRef, RULE_OPERATORS } from './utils';

export default function RulesTab({ rules, setRules, fields, fieldsSaved }) {
  const conditionFields = compareFields(fields);

  function updateRule(key, patch) {
    setRules((current) =>
      current.map((rule) => (rule._key === key ? { ...rule, ...patch } : rule))
    );
  }

  function removeRule(key) {
    setRules((current) => current.filter((rule) => rule._key !== key));
  }

  function addRule() {
    setRules((current) => [...current, emptyRule()]);
  }

  return (
    <div className="master-builder-tab">
      {!fieldsSaved ? (
        <p className="master-builder-notice">
          Add your fields here first, then switch to Rules. Click Save at the top to store everything.
        </p>
      ) : null}

      {rules.length === 0 ? <p className="muted">No rules yet.</p> : null}

      <div className="master-rule-list">
        {rules.map((rule) => (
          <div key={rule._key} className="master-rule-row">
            <label>
              Rule Name
              <input
                type="text"
                value={rule.name}
                onChange={(event) => updateRule(rule._key, { name: event.target.value })}
              />
            </label>

            <label>
              Condition field
              <select
                value={rule.condition_field_id}
                onChange={(event) =>
                  updateRule(rule._key, { condition_field_id: event.target.value })
                }
              >
                <option value="">Select field</option>
                {conditionFields.map((field) => (
                  <option key={fieldRef(field)} value={fieldRef(field)}>
                    {field.label || field.field_key}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Operator
              <select
                value={rule.operator}
                onChange={(event) => updateRule(rule._key, { operator: event.target.value })}
              >
                {RULE_OPERATORS.map((operator) => (
                  <option key={operator.value} value={operator.value}>
                    {operator.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="master-rule-compare">
              <span className="master-field-extra-label">Compare to</span>
              <div className="master-rule-compare-toggle">
                <label>
                  <input
                    type="radio"
                    name={`compare-${rule._key}`}
                    checked={rule.compareMode === 'fixed'}
                    onChange={() =>
                      updateRule(rule._key, {
                        compareMode: 'fixed',
                        threshold_field_id: null,
                      })
                    }
                  />
                  Fixed value
                </label>
                <label>
                  <input
                    type="radio"
                    name={`compare-${rule._key}`}
                    checked={rule.compareMode === 'field'}
                    onChange={() =>
                      updateRule(rule._key, {
                        compareMode: 'field',
                        threshold_value: '',
                      })
                    }
                  />
                  Another field
                </label>
              </div>
                  
              <div className="master-rule-threshold">

                {rule.compareMode === 'fixed' ? (
                  <label>
                    Threshold value
                    <input
                      type="number"
                      value={rule.threshold_value}
                      onChange={(event) =>
                        updateRule(rule._key, { threshold_value: event.target.value })
                      }
                    />
                  </label>
                ) : (
                  <label>
                    Threshold field
                    <select
                      value={rule.threshold_field_id || ''}
                      onChange={(event) =>
                        updateRule(rule._key, {
                          threshold_field_id: event.target.value || null,
                        })
                      }
                    >
                      <option value="">Select field</option>
                      {conditionFields.map((field) => (
                        <option key={fieldRef(field)} value={fieldRef(field)}>
                          {field.label || field.field_key}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

              <label>
                Action type
                <select
                  value={rule.action_type}
                  onChange={(event) => updateRule(rule._key, { action_type: event.target.value })}
                  >
                  <option value="alert">Alert</option>
                  <option value="highlight">Highlight</option>
                  <option value="block">Block</option>
                </select>
              </label>
            </div>

            </div>
            <label className="master-rule-message">
              Action message
              <input
                type="text"
                value={rule.action_message}
                onChange={(event) => updateRule(rule._key, { action_message: event.target.value })}
                placeholder="Message shown when rule triggers"
                />
            </label>

            <button
              type="button"
              className="icon-button master-field-remove"
              onClick={() => removeRule(rule._key)}
              aria-label="Remove rule"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="secondary-button" onClick={addRule}>
        + Add rule
      </button>
    </div>
  );
}
