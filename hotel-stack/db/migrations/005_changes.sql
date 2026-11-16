-- Doss's proposals (and the owner's decisions). Nothing goes live until status = 'applied' (owner approved).
-- files keeps before/after of every touched file, so a change can be undone without git.
create table changes (
  id           bigserial primary key,
  kind         text not null default 'files',   -- files | rollback (guest_texts, mini_app later)
  title        text not null,
  reason       text not null default '',
  proposal     jsonb not null,                   -- the BAML ChangeProposal as submitted
  files        jsonb not null default '[]',      -- [{path, before, after, before_hash}] (before null = new file, after null = delete)
  areas        jsonb not null default '[]',      -- voice | text | kb | facts | templates | evals | code | dashboard | migrations
  status       text not null default 'checking', -- checking | ready | failed | applied | rejected | undone
  checks       jsonb not null default '{}',      -- {name: {ok, detail}} + review (BAML ChangeReview)
  created_by   text not null default 'doss',
  decided_by   text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  version_id   bigint                            -- config_versions id when applying published Danny
);
create index changes_status on changes (status);
