
SELECT id, htsno, descript, indent, embedding IS NULL as needs_embedding
FROM tariff_codes 
WHERE indent <= 2 
  AND htsno IS NOT NULL 
  AND embedding IS NULL
LIMIT 10;