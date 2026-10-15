SELECT 'Movimientos normales' AS tabla, COUNT(*) AS total
FROM public.transactions

UNION ALL

SELECT 'Movimientos históricos', COUNT(*)
FROM public.historical_transactions

UNION ALL

SELECT 'Operaciones', COUNT(*)
FROM public.operations

UNION ALL

SELECT 'Asientos contables', COUNT(*)
FROM public.ledger_entries;