-- Reports Doss writes (scheduled jobs or on request): shown on the dashboard's Reports page.
create table reports (
  id          bigserial primary key,
  title       text not null,
  body        text not null,                  -- markdown
  kind        text not null default 'report', -- e.g. daily-summary, kb-gaps, deposits, arrivals, or anything Doss names
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index reports_created on reports (created_at desc);
