function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function evaluateDimensionalResult(parameter, measuredValue) {
  const measured = toNumber(measuredValue);
  if (measured === null) return 'fail';

  const nominal = toNumber(parameter.nominal_value);
  if (nominal === null) return 'fail';

  const tolPlus = toNumber(parameter.tol_plus) ?? 0;
  const tolMinus = toNumber(parameter.tol_minus) ?? 0;
  const upper = nominal + tolPlus;
  const lower = nominal - tolMinus;

  if (measured >= lower && measured <= upper) return 'pass';
  return 'fail';
}

function evaluateParameterResult(parameter, input = {}) {
  const checkType = parameter.check_type;

  if (checkType === 'dimensional') {
    const result = evaluateDimensionalResult(parameter, input.measured_value);
    return { result, measured_value: toNumber(input.measured_value) };
  }

  const result = input.result === 'pass' || input.result === 'fail' || input.result === 'na'
    ? input.result
    : 'fail';

  return { result, measured_value: toNumber(input.measured_value) };
}

function computeOverallResult(parameters = [], valueResults = [], documents = [], uploadedDocs = []) {
  for (const param of parameters) {
    if (!param.is_mandatory) continue;
    const row = valueResults.find((v) => v.plan_parameter_id === param.id);
    if (!row || row.result !== 'pass') {
      return 'fail';
    }
  }

  for (const doc of documents) {
    if (!doc.is_mandatory) continue;
    const uploaded = uploadedDocs.find((d) => d.document_type === doc.document_type);
    if (!uploaded || !uploaded.verified) {
      return 'fail';
    }
  }

  return 'pass';
}

module.exports = {
  evaluateDimensionalResult,
  evaluateParameterResult,
  computeOverallResult,
};
