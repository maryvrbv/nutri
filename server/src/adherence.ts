export type IntakeStatus = 'planned' | 'taken' | 'skipped' | 'unmarked' | 'cancelled';

export function intakeStatus(row: { status: string; mark_status?: string | null; due_at: string }, nowIso: string): IntakeStatus {
  if (row.mark_status === 'taken') return 'taken';
  if (row.mark_status === 'skipped') return 'skipped';
  if (row.status === 'cancelled') return 'cancelled';
  return row.due_at > nowIso ? 'planned' : 'unmarked';
}

export type AdherenceStats = {
  planned_total: number;   // все запланированные в периоде, кроме отменённых
  past: number;            // наступившие запланированные приёмы — база для процентов
  taken: number;
  skipped: number;
  unmarked: number;
  future: number;
  cancelled: number;
  adherence: number | null;    // принято / наступившие
  completeness: number | null; // (принято + явные пропуски) / наступившие
};

/**
 * Процент выполнения считается только по наступившим запланированным приёмам.
 * Отменённые и будущие исключены. Отсутствие отметки не считается пропуском —
 * его отражает полнота заполнения.
 */
export function adherenceStats(statuses: IntakeStatus[]): AdherenceStats {
  const c = { taken: 0, skipped: 0, unmarked: 0, planned: 0, cancelled: 0 };
  for (const s of statuses) c[s]++;
  const past = c.taken + c.skipped + c.unmarked;
  return {
    planned_total: past + c.planned,
    past,
    taken: c.taken,
    skipped: c.skipped,
    unmarked: c.unmarked,
    future: c.planned,
    cancelled: c.cancelled,
    adherence: past ? c.taken / past : null,
    completeness: past ? (c.taken + c.skipped) / past : null,
  };
}
