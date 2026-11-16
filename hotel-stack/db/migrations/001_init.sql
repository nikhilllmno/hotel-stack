-- Core tables for one hotel's deployment. Applied by: uv run python -m hotelcore.db migrate

-- One row per voice call (Vapi end-of-call report) or text conversation later.
create table calls (
  id             text primary key,            -- Vapi call id
  channel        text not null default 'voice',
  started_at     timestamptz,
  ended_at       timestamptz,
  duration_s     numeric,
  caller_phone   text,
  ended_reason   text,
  cost_usd       numeric,
  recording_url  text,
  transcript     text,
  messages       jsonb,                       -- turn-by-turn, including tool calls and results
  summary        text,                        -- written by hotel core (Claude), not Vapi
  intent         text,                        -- e.g. new_booking, existing_booking, modify_booking, question, complaint, other
  outcome        text,                        -- e.g. booked, quoted_no_booking, message_taken, answered, abandoned
  sentiment      text,                        -- positive | neutral | negative
  booking_id     bigint,                      -- Beds24 booking created on this call, if any
  booking_amount numeric,
  analyzed_at    timestamptz,
  raw            jsonb not null               -- the full end-of-call report
);
create index calls_started_at on calls (started_at desc);
create index calls_intent on calls (intent);

-- Every tool call any agent made (audit + latency).
create table tool_calls (
  id          bigserial primary key,
  call_id     text,
  channel     text not null,
  name        text not null,
  arguments   jsonb,
  ok          boolean not null,
  result      jsonb,
  error       text,
  ms          integer,
  created_at  timestamptz not null default now()
);
create index tool_calls_call on tool_calls (call_id);

-- Messages for the hotel team (take_message).
create table team_messages (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  channel         text not null,
  call_id         text,
  caller_phone    text,
  guest_name      text,
  callback_phone  text,
  reason          text not null,
  status          text not null default 'open'   -- open | done
);

-- Every publish of the voice agent: what went live, so it can be diffed and rolled back.
create table config_versions (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  author        text not null,                   -- human, doss, or a person's name
  note          text,
  files         jsonb not null,                  -- path -> content of hotels/<id>/ at publish time
  assistant     jsonb not null                   -- the payload sent to Vapi
);

-- Eval runs (scenario results graded by a judge model).
create table eval_runs (
  id                 bigserial primary key,
  started_at         timestamptz not null default now(),
  config_version_id  bigint references config_versions(id),
  total              integer not null,
  passed             integer not null,
  results            jsonb not null              -- per scenario: name, passed, reply, tool_calls, verdict
);
