-- Guest texts proposed by Doss: sent on approval, or at send_at (scheduled). sent = per-recipient results.
alter table changes add column send_at timestamptz;
alter table changes add column sent jsonb;
-- status adds: scheduled (approved, waiting for send_at) | sending (claimed by the sender)
