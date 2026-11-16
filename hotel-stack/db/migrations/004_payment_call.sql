-- The Vapi call a payment link was sent from, so a payment made during that call can be announced live by Danny.
alter table payments add column call_id text;
