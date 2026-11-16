-- Mini apps Doss builds (approved through the changes engine, kind mini_app).
create table mini_apps (
  slug        text primary key,
  title       text not null,
  description text not null default '',
  html        text not null,
  public      boolean not null default false,
  version     int not null default 1,
  change_id   bigint,            -- the change that published this version
  updated_at  timestamptz not null default now()
);
