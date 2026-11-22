import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import webpush from 'npm:web-push@3.6.7';

// Familienkalender: Push-Test und automatische Erinnerungen.
// POST: existing REMINDER_CRON_SECRET or a short-lived Vault-backed HMAC signature.
// Signatures bind the timestamp and mode; the long-lived key never leaves Vault.
// Body: {"mode":"dry-run"} | {"mode":"test"} | {"mode":"run"}

const FAMILY_ID = '11111111-1111-4111-8111-111111111111';
const PEOPLE: Record<string, string> = {
  daniel: 'b0807984-7383-4a8b-9ae8-8d7a05375056',
  caro: '51fa4afb-aa64-454e-aa0f-eab60b388b28',
  lara: '9c4a8518-075f-48e1-a05e-55b3ded35ec0',
};
const ALL_USERS = Object.values(PEOPLE);
const DEFAULT_ZONE = 'Europe/Berlin';
const MAX_LATENESS_MS = 24 * 60 * 60 * 1000;

type Candidate = {
  key: string; type: string; sourceId: string; scheduled: Date;
  recipients: string[]; title: string; body: string;
};
type Settings = {
  user_id: string; enabled: boolean; quiet_enabled: boolean;
  quiet_start: string | null; quiet_end: string | null; timezone: string | null;
};

function parts(date: Date, zone = DEFAULT_ZONE) {
  const x = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (k: string) => x.find(v => v.type === k)?.value || '00';
  return { day: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')) };
}
function localDateTime(day: string, time: string, zone = DEFAULT_ZONE): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, h || 0, min || 0);
  const wall = (instant: number) => {
    const p = parts(new Date(instant), zone);
    const [py, pm, pd] = p.day.split('-').map(Number);
    return Date.UTC(py, pm - 1, pd, Math.floor(p.minute / 60), p.minute % 60);
  };
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = target + hours * 3600000;
    offsets.add(wall(probe) - probe);
  }
  const candidates = [...offsets].map(offset => target - offset);
  const exact = candidates.filter(instant => wall(instant) === target);
  // Repeated autumn hour: first occurrence. Missing spring hour: move forward by the gap.
  if (exact.length) return new Date(Math.min(...exact));
  const after = candidates.filter(instant => wall(instant) >= target)
    .sort((a, b) => wall(a) - wall(b) || a - b);
  if (!after.length) throw new Error('Local date/time could not be resolved');
  return new Date(after[0]);
}
function reminderLeads(row: any): number[] {
  const allowed = [15, 30, 60, 1440, 10080];
  return [...new Set<number>([row.reminder_minutes, row.reminder2_minutes]
    .filter(value => typeof value === 'number' && allowed.includes(value)))];
}
function reminderDate(day: string, time: string, lead: number): Date {
  // Day/week choices preserve Berlin wall-clock time across 23/25-hour DST days.
  if (lead === 1440 || lead === 10080) return localDateTime(dateShift(day, -lead / 1440), time);
  return new Date(localDateTime(day, time).getTime() - lead * 60000);
}
function dateShift(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
function occurs(event: any, day: string) {
  const start = String(event.start || '');
  const end = String(event.end || start);
  if (!start || day < start) return false;
  const duration = Math.max(0, Math.min(366, daysBetween(start, end)));
  for (let offset = 0; offset <= duration; offset++) {
    const base = dateShift(day, -offset);
    if (base < start) continue;
    const diff = daysBetween(start, base);
    switch (event.rep || 'none') {
      case 'none': if (base === start) return true; break;
      case 'daily': return true;
      case 'weekly': if (diff % 7 === 0) return true; break;
      case 'monthly': if (base.slice(8) === start.slice(8)) return true; break;
      case 'yearly': if (base.slice(5) === start.slice(5)) return true; break;
    }
  }
  return false;
}
function members(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = [v]; }
  }
  return Array.isArray(v) ? v.map(String).filter(k => !!PEOPLE[k]) : [];
}
function recipients(visibility: string, raw: unknown, creator: string | null) {
  // Current events/tasks SELECT policies authorize private rows only for their creator.
  // The service-role sender must enforce that same restriction before exposing a title.
  if (visibility === 'private') return creator && ALL_USERS.includes(creator) ? [creator] : [];
  const assigned = members(raw).map(k => PEOPLE[k]);
  return assigned.length ? [...new Set(assigned)] : ALL_USERS.slice();
}
function minutes(t: string | null | undefined) {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function inQuiet(now: Date, s: Settings) {
  if (!s.quiet_enabled) return false;
  const start = minutes(s.quiet_start), end = minutes(s.quiet_end);
  if (start === null || end === null || start === end) return false;
  const current = parts(now, s.timezone || DEFAULT_ZONE).minute;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}
function effectiveDue(scheduled: Date, s: Settings) {
  if (!s.quiet_enabled) return scheduled;
  // Check minute by minute up to 24h; quiet boundaries are minute-precise.
  const d = new Date(scheduled);
  for (let i = 0; i <= 1440 && inQuiet(d, s); i++) d.setUTCMinutes(d.getUTCMinutes() + 1);
  return d;
}
function required(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}
function configurePush() {
  webpush.setVapidDetails(required('VAPID_SUBJECT'), required('VAPID_PUBLIC_KEY'), required('VAPID_PRIVATE_KEY'));
}
async function readAll(sb: any, table: string, select: string) {
  const rows: any[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await sb.from(table).select(select)
      .eq('family_id', FAMILY_ID).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
  throw new Error(`${table}: too many rows; increase pagination limit`);
}
async function buildCandidates(sb: any, now: Date): Promise<Candidate[]> {
  const today = parts(now).day;
  // Includes yesterday's reminders that may be delayed by quiet hours.
  const days = Array.from({ length: 12 }, (_, i) => dateShift(today, i - 2));
  const [events, tasks, anniversaries] = await Promise.all([
    readAll(sb, 'events', 'id,title,start,end,allDay,st,ms,rep,reminder_minutes,reminder2_minutes,legacy_due_notification,created_by,visibility'),
    readAll(sb, 'tasks', 'id,title,assigned_to,due_date,due_time,completed,visibility,created_by,reminder_minutes,reminder2_minutes,legacy_due_notification'),
    readAll(sb, 'anniversaries', 'id,title,kind,event_date'),
  ]);
  const result: Candidate[] = [];
  for (const e of events) {
    const configured = reminderLeads(e);
    const legacy = e.legacy_due_notification ?? e.allDay;
    const leads = configured.length ? configured : (legacy && e.allDay ? [0] : []);
    for (const day of days) {
      if (!leads.length || !occurs(e, day)) continue;
      for (const lead of leads) {
        const scheduled = reminderDate(day, e.allDay ? '09:00' : (e.st || '09:00'), lead);
        // Retain the first-reminder key format. Slot swaps and equal leads must not resend.
        result.push({ key: `event:${e.id}:${day}:${lead}`, type: 'event', sourceId: e.id,
          scheduled, recipients: recipients(e.visibility, e.ms, e.created_by),
          title: '📅 Terminerinnerung', body: String(e.title || 'Termin') });
      }
    }
  }
  for (const t of tasks) {
    if (t.completed || !t.due_date) continue;
    const person = PEOPLE[String(t.assigned_to || '').toLowerCase()];
    const targets = t.visibility === 'private'
      ? recipients('private', [], t.created_by)
      : person ? [person] : (ALL_USERS.includes(t.created_by) ? [t.created_by] : []);
    const configured = reminderLeads(t);
    // Missing fields also support old fixtures/records. Migrated rows have an explicit marker.
    const legacy = t.legacy_due_notification ??
      (t.reminder_minutes === undefined && t.reminder2_minutes === undefined);
    const leads = configured.length ? configured : (legacy ? [0] : []);
    for (const lead of leads) {
      const time = t.due_time || '09:00';
      const key = configured.length
        ? `task:${t.id}:${t.due_date}:${String(time).slice(0,5)}:lead:${lead}`
        : `task:${t.id}:${t.due_date}:${time}`;
      result.push({ key, type: 'task', sourceId: t.id,
        scheduled: reminderDate(t.due_date, time, lead), recipients: targets,
        title: configured.length ? '✅ Aufgabenerinnerung' : '✅ Aufgabe fällig',
        body: String(t.title || 'Aufgabe') });
    }
  }
  for (const a of anniversaries) {
    if (!a.event_date) continue;
    for (const day of days) {
      if (day < a.event_date || day.slice(5) !== a.event_date.slice(5)) continue;
      result.push({ key: `anniversary:${a.id}:${day}`, type: 'anniversary', sourceId: a.id,
        scheduled: localDateTime(day, '09:00'), recipients: ALL_USERS,
        title: a.kind === 'birthday' ? '🎂 Geburtstag' : '📆 Jahrestag',
        body: String(a.title || 'Jahrestag') });
    }
  }
  return result;
}
async function sendToUser(sb: any, userId: string, payload: object) {
  const { data, error } = await sb.from('push_subscriptions')
    .select('id,endpoint,p256dh,auth_key').eq('user_id', userId);
  if (error) throw new Error(`push_subscriptions: ${error.message}`);
  if (!data?.length) throw new Error('No push subscription for recipient');
  let delivered = 0;
  const failures: string[] = [];
  for (const sub of data) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      }, JSON.stringify(payload), { TTL: 3600 });
      delivered++;
    } catch (e) {
      const status = Number((e as any)?.statusCode || 0);
      if (status === 404 || status === 410) {
        await sb.from('push_subscriptions').delete().eq('id', sub.id);
      }
      failures.push(`HTTP ${status || '?'}: ${String((e as Error).message).slice(0, 140)}`);
    }
  }
  if (!delivered) throw new Error(failures.join('; ') || 'Push delivery rejected');
  return { delivered, failures };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const legacySecret = Deno.env.get('REMINDER_CRON_SECRET');
  const legacyAuthorized = !!legacySecret && req.headers.get('Authorization') === `Bearer ${legacySecret}`;
  const schedulerTimestamp = req.headers.get('x-reminder-timestamp');
  const schedulerSignature = req.headers.get('x-reminder-signature');
  if (!legacyAuthorized && (!schedulerTimestamp || !schedulerSignature)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sb = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'dry-run';
    if (!['dry-run', 'test', 'run'].includes(mode)) {
      return Response.json({ error: 'Invalid mode' }, { status: 400 });
    }
    if (!legacyAuthorized) {
      const verification = await sb.rpc('verify_family_reminder_scheduler_request', {
        p_mode: mode, p_timestamp: schedulerTimestamp, p_signature: schedulerSignature,
      });
      if (verification.error) throw new Error('Scheduler authorization unavailable');
      if (verification.data !== true) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (mode === 'test') {
      configurePush();
      const result = await sendToUser(sb, PEOPLE.daniel, {
        title: 'Familienkalender', body: '🔔 Push-Test erfolgreich', url: './',
        tag: `manual-test-${Date.now()}`,
      });
      return Response.json({ success: true, mode, ...result });
    }
    const now = new Date();
    const [candidates, settingsResult] = await Promise.all([
      buildCandidates(sb, now),
      sb.from('notification_settings').select('user_id,enabled,quiet_enabled,quiet_start,quiet_end,timezone')
        .in('user_id', ALL_USERS),
    ]);
    if (settingsResult.error) throw new Error(`notification_settings: ${settingsResult.error.message}`);
    const settings = new Map<string, Settings>((settingsResult.data || []).map((x: Settings) => [x.user_id, x]));
    const due: Array<{ c: Candidate; userId: string; due: Date }> = [];
    for (const c of candidates) {
      for (const userId of new Set(c.recipients)) {
        const s = settings.get(userId);
        if (!s?.enabled || inQuiet(now, s)) continue;
        const adjusted = effectiveDue(c.scheduled, s);
        if (adjusted.getTime() > now.getTime()) continue;
        if (now.getTime() - c.scheduled.getTime() > MAX_LATENESS_MS) continue;
        due.push({ c, userId, due: adjusted });
      }
    }
    if (mode === 'dry-run') {
      // Do not expose private titles or names in the diagnostic response.
      return Response.json({ success: true, mode, now: now.toISOString(),
        candidates: candidates.length, due: due.length,
        due_types: due.reduce((acc: Record<string, number>, x) => {
          acc[x.c.type] = (acc[x.c.type] || 0) + 1; return acc;
        }, {}), no_push_sent: true });
    }
    configurePush();
    let sent = 0, skipped = 0, failed = 0, lateSent = 0, maxDelaySeconds = 0;
    for (const { c, userId, due: quietAdjusted } of due) {
      let deliveryKey = c.key;
      if (c.type === 'event') {
        // Preserve legacy keys for unchanged reminders. A changed scheduled instant
        // needs a distinct key so editing the event time does not suppress its push.
        const prior = await sb.from('notification_deliveries').select('scheduled_for')
          .eq('user_id', userId).eq('notification_key', c.key);
        if (prior.error) throw new Error(`delivery lookup: ${prior.error.message}`);
        const previous = prior.data?.[0]?.scheduled_for;
        if (previous && Date.parse(previous) !== c.scheduled.getTime()) {
          deliveryKey = `${c.key}:at:${c.scheduled.toISOString()}`;
        }
      }
      const { data: claimed, error: claimError } = await sb.rpc('claim_notification_delivery', {
        p_user_id: userId, p_notification_key: deliveryKey, p_notification_type: c.type,
        p_source_id: c.sourceId, p_scheduled_for: c.scheduled.toISOString(),
      });
      if (claimError) throw new Error(`claim_notification_delivery: ${claimError.message}`);
      if (!claimed) { skipped++; continue; }
      try {
        const attemptedAt = new Date();
        await sendToUser(sb, userId, {
          title: c.title, body: c.body, url: './', tag: deliveryKey,
        });
        const acceptedAt = new Date();
        const delaySeconds = Math.max(0, Math.round((acceptedAt.getTime() - c.scheduled.getTime()) / 1000));
        maxDelaySeconds = Math.max(maxDelaySeconds, delaySeconds);
        if (delaySeconds > 90) lateSent++;
        console.info(JSON.stringify({ event: 'reminder_provider_accepted', notification_key: deliveryKey,
          scheduled_for: c.scheduled.toISOString(), quiet_adjusted_for: quietAdjusted.toISOString(),
          attempted_at: attemptedAt.toISOString(), provider_accepted_at: acceptedAt.toISOString(),
          seconds_after_scheduled: delaySeconds,
          seconds_after_quiet_adjusted: Math.max(0, Math.round((acceptedAt.getTime() - quietAdjusted.getTime()) / 1000)) }));
        const { error } = await sb.from('notification_deliveries').update({
          status: 'sent', sent_at: acceptedAt.toISOString(), last_error: null,
        }).eq('user_id', userId).eq('notification_key', deliveryKey).eq('status', 'processing');
        if (error) throw new Error(`delivery update: ${error.message}`);
        sent++;
      } catch (e) {
        const message = String((e as Error).message).slice(0, 500);
        console.error('Reminder delivery failed:', c.type, c.sourceId, userId, message);
        await sb.from('notification_deliveries').update({
          status: 'failed', last_error: message,
        }).eq('user_id', userId).eq('notification_key', deliveryKey).eq('status', 'processing');
        failed++;
      }
    }
    return Response.json({ success: true, mode, due: due.length, sent, skipped, failed, late_sent: lateSent, max_delay_seconds: maxDelaySeconds });
  } catch (e) {
    console.error('send-reminders failed:', e);
    return Response.json({ success: false, error: String((e as Error).message).slice(0, 350) }, { status: 500 });
  }
});
