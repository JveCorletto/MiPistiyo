-- MiPistiyo — Reinicio de todos los movimientos financieros
-- Compatible con 001_initial_schema_corrected.sql + 003_historical_movements.sql
-- EJECUTAR SOLO con respaldo previo y si se desea descartar TODOS los movimientos
-- Mantiene: usuarios, perfiles, whitelist, cuentas y sus opening_balance,
-- tarjetas y sus opening_debt, préstamos y sus opening_debt,
-- categorías, presupuestos, reglas recurrentes y estados de cuenta.
-- Elimina: historial normal, historial informativo, asientos, operaciones,
-- transferencias, abonos, ajustes y ocurrencias recurrentes generadas.
-- No usa CASCADE: si hay alguna dependencia nueva, la transacción FALLARÁ
-- en lugar de borrar tablas adicionales accidentalmente.

BEGIN;

SET LOCAL lock_timeout = '10s';

TRUNCATE TABLE
    public.historical_transactions,
    public.transactions,
    public.transfers,
    public.card_payments,
    public.loan_payments,
    public.financial_adjustments,
    public.recurring_occurrences,
    public.ledger_entries,
    public.operations;

COMMIT;

-- Verificación posterior; todas estas cantidades deben ser 0.
SELECT 'historical_transactions' AS tabla, count(*) AS registros FROM public.historical_transactions
UNION ALL SELECT 'transactions', count(*) FROM public.transactions
UNION ALL SELECT 'transfers', count(*) FROM public.transfers
UNION ALL SELECT 'card_payments', count(*) FROM public.card_payments
UNION ALL SELECT 'loan_payments', count(*) FROM public.loan_payments
UNION ALL SELECT 'financial_adjustments', count(*) FROM public.financial_adjustments
UNION ALL SELECT 'recurring_occurrences', count(*) FROM public.recurring_occurrences
UNION ALL SELECT 'ledger_entries', count(*) FROM public.ledger_entries
UNION ALL SELECT 'operations', count(*) FROM public.operations
ORDER BY tabla;