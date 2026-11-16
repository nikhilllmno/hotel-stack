-- Deposit payment links. provider = 'demo' now; 'stripe' later (same table, provider_ref = Checkout Session id).
create table payments (
  id            bigserial primary key,
  token         text unique not null,           -- random; the public link is /pay/<token>
  booking_id    bigint not null,
  guest_phone   text,
  amount        numeric not null,               -- deposit to collect, in currency below
  currency      text not null default 'USD',
  provider      text not null default 'demo',
  provider_ref  text,
  status        text not null default 'open',   -- open | paid | expired
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  paid_at       timestamptz
);
create index payments_booking on payments (booking_id);
