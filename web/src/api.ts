export class ApiError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(status: number, data: any) {
    super(data?.message ?? 'Не удалось выполнить запрос');
    this.status = status;
    this.code = data?.error ?? 'error';
    this.data = data;
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { raw?: Blob | ArrayBuffer; contentType?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-nutri'] = '1';
  let payload: BodyInit | undefined;
  if (opts.raw) { payload = opts.raw as BodyInit; headers['content-type'] = opts.contentType ?? 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  let res: Response;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, { error: 'network', message: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.' });
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new CustomEvent('nutri:unauthorized'));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: <T = any>(p: string, file: File) => request<T>('POST', p, undefined, { raw: file, contentType: file.type || 'application/octet-stream' }),
};

export const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export type Me = {
  id: string; email: string; name: string; role: 'client' | 'specialist'; timezone: string; title: string | null; today: string; sex: 'female' | 'male' | null; birth_date: string | null;
  settings: { quiet_from: string | null; quiet_to: string | null; channel_inapp: boolean; channel_browser: boolean; hide_sensitive: boolean; intake_reminders: boolean };
};

export type IntakeState = 'planned' | 'taken' | 'skipped' | 'unmarked' | 'cancelled';
export type Intake = {
  id: string; scheme_id: string; version_id: string; group_key: string; date: string; slot: string; time_local: string; due_at: string;
  status: string; state: IntakeState; name: string; product: string; form: string; amount: number; amount_unit: string;
  substance_amount: number | null; substance_unit: string | null; food: string; instruction: string;
  version_number: number; scheme_title: string; mark_status: string | null; taken_at: string | null; reason: string | null; recorded_at: string | null;
  snooze_until: string | null;
};

export type Dose = { time?: string; part?: string };
export type Frequency = { type: 'daily' } | { type: 'weekdays'; days: number[] } | { type: 'every_other_day' };
export type SchemeItem = {
  id?: string; group_key?: string; name: string; product: string; form: string; amount: number | string; amount_unit: string;
  substance_amount: number | string | null; substance_unit: string | null; doses: Dose[]; frequency: Frequency; food: string;
  start_date: string; end_date: string; instruction: string;
};
export type Version = {
  id: string; number: number; title: string; comment: string; start_date: string; end_date: string; control_date: string | null;
  effective_from: string | null; published_at: string | null; published_by_name?: string; created_at: string;
  changes: { kind: 'added' | 'removed' | 'changed'; name: string; fields?: { field: string; before: string; after: string }[] }[] | null;
  items: SchemeItem[];
};
export type Scheme = {
  id: string; client_id: string; specialist_name: string; status: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';
  created_at: string; cancelled_at: string | null; cancel_reason: string | null; current: Version | null; draft: Version | null; versions: Version[]; today: string;
};

export type Stats = { planned_total: number; past: number; taken: number; skipped: number; unmarked: number; future: number; cancelled: number; adherence: number | null; completeness: number | null };

export type Result = {
  id: string; document_id: string; analyte_code: string | null; name: string; value_num: number | null; value_text: string; unit: string;
  ref_low: number | null; ref_high: number | null; ref_text: string; ref_source?: 'lab' | 'reference' | null; ref_note?: string | null; lab_flag: string; collected_at: string | null; low_confidence: string[];
  recognized: any; source: 'recognized' | 'manual'; status: 'draft' | 'confirmed'; edited_by_name?: string | null; edited_at?: string | null;
  lab?: string | null; key?: string; count?: number;
};
export type Doc = {
  id: string; owner_id: string; file_name: string; mime: string; size: number; pages: number | null; lab: string | null; collected_at: string | null;
  uploaded_at: string; status: 'uploaded' | 'processing' | 'needs_review' | 'confirmed' | 'error'; error: string | null; patient_name: string | null;
  ownership: 'ok' | 'needs_check' | 'confirmed'; recognizer: string | null; uploaded_by: string; uploaded_by_name: string; confirmed_by_name?: string | null;
  confirmed_at: string | null; results: Result[]; results_count?: number;
};
export type Comment = { id: string; kind: 'conclusion' | 'internal' | 'question'; target_type: string; target_id: string | null; body: string; created_at: string; author_id: string; author_name: string; author_role: string };
export type Wellbeing = { id: string; date: string; energy: number | null; sleep: number | null; overall: number | null; symptoms: string[]; adverse: boolean | number; comment: string; updated_at: string };
export type Notification = { id: string; kind: string; title: string; body: string; public_title: string; link: string | null; created_at: string; read_at: string | null };
