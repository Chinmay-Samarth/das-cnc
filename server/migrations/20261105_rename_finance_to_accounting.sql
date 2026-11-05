-- Rename Finance department → Accounting; map legacy FINANCE job titles.
UPDATE departments
SET name = 'Accounting'
WHERE UPPER(TRIM(name)) IN ('FINANCE', 'FINANCE DEPARTMENT');

UPDATE employees
SET job_description = 'ACCOUNTING'
WHERE UPPER(TRIM(job_description)) = 'FINANCE';
