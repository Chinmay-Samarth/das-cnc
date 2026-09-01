export function sortBy(rows, key, asc, accessor) {
  if (!key) return rows;

  const getValue = accessor || ((row) => row[key] ?? row.values?.[key] ?? '');

  return [...rows].sort((a, b) => {
    const leftRaw = getValue(a) ?? '';
    const rightRaw = getValue(b) ?? '';

    const leftNum = Number(leftRaw);
    const rightNum = Number(rightRaw);
    if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && String(leftRaw) !== '' && String(rightRaw) !== '') {
      if (leftNum === rightNum) return 0;
      return asc ? leftNum - rightNum : rightNum - leftNum;
    }

    const left = String(leftRaw).toLowerCase();
    const right = String(rightRaw).toLowerCase();
    if (left === right) return 0;
    return asc ? (left < right ? -1 : 1) : left > right ? -1 : 1;
  });
}

export function getVisiblePages(currentPage, totalPages) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage]);
  if (currentPage > 1) pages.add(currentPage - 1);
  if (currentPage < totalPages) pages.add(currentPage + 1);

  return [...pages].sort((a, b) => a - b);
}
