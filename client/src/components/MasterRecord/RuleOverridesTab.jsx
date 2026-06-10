export default function RuleOverridesTab({ rules, overrides, setOverrides }) {
  if (rules.length === 0) {
    return <p className="muted">No rules defined for this master.</p>;
  }

  return (
    <div className="master-rule-override-list">
      {rules.map((rule) => {
        const currentValue =
          overrides[rule.id] !== undefined ? overrides[rule.id] : rule.threshold_value ?? '';
        const isOverridden =
          overrides[rule.id] !== undefined &&
          String(overrides[rule.id]) !== String(rule.threshold_value ?? '');

        return (
          <div key={rule.id} className="master-rule-override-row">
            <div className="master-rule-override-meta">
              <strong>{rule.name || 'Unnamed rule'}</strong>
              {rule.action_message ? <p className="muted">{rule.action_message}</p> : null}
              <p className="master-rule-default">
                Default threshold: {rule.threshold_value ?? '—'}
              </p>
            </div>

            <label>
              Record override
              <input
                type="number"
                value={currentValue}
                className={isOverridden ? 'input-overridden' : ''}
                onChange={(event) => {
                  const next = event.target.value;
                  setOverrides((current) => {
                    const updated = { ...current };
                    if (next === '' || String(next) === String(rule.threshold_value ?? '')) {
                      delete updated[rule.id];
                    } else {
                      updated[rule.id] = next;
                    }
                    return updated;
                  });
                }}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
