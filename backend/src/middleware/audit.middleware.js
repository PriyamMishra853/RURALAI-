import { supabaseAdmin } from '../config/supabase.js';
import { ROLE_API_TO_DB } from '../config/roles.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

/**
 * Keys that must never reach the audit table.
 *
 * The audit log is the one table the widest set of roles can read (every admin
 * tier plus auditors), so writing an identifier into it hands that identifier
 * to everyone holding oversight access. Aadhaar in particular is stored on
 * `patients` by design; it does not also belong in a log read by non-clinical
 * staff.
 */
const REDACT_KEYS = new Set([
  'aadhaar', 'aadhaar_number', 'aadhar', 'password', 'token', 'abha_number'
]);

const redact = (obj) => {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      // Keep the last 4 so an event is still traceable to a record without
      // reproducing the identifier.
      out[k] = typeof v === 'string' && v.length >= 4 ? `****${v.slice(-4)}` : '[redacted]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
};

export const logAuditEvent = async ({
  actorId, actorRole, action, entityType, entityId, metadata = {}, ip
}) => {
  try {
    const record = {
      actor_id: asUuid(actorId),
      // Accepts either the API name or the DB enum value.
      actor_role: ROLE_API_TO_DB[actorRole] || actorRole || null,
      action,
      entity_type: entityType || null,
      // entity_id is TEXT in v2: a patient's key is a 12-digit Aadhaar, not a
      // UUID, so this column cannot be UUID-typed. Redacted for that case.
      entity_id: entityId ? String(entityId).replace(/^\d{8}(\d{4})$/, '****$1') : null,
      metadata: redact(metadata),
      ip_address: ip || null
    };

    const { error } = await supabaseAdmin.from('audit_logs').insert([record]);
    if (error) console.warn('Audit log insert failed:', error.message);
  } catch (err) {
    // An audit failure must never break the request it is recording.
    console.error('Audit log error:', err.message);
  }
};
