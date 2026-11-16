-- Every SMS in and out. A guest's thread is all rows with their phone number (E.164).
create table text_messages (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  guest_phone  text not null,
  direction    text not null check (direction in ('in', 'out')),
  body         text not null,
  twilio_sid   text unique,                 -- MessageSid; makes webhook retries idempotent
  tools        jsonb                        -- tool calls the agent made to produce this reply (out only)
);
create index text_messages_thread on text_messages (guest_phone, created_at);
