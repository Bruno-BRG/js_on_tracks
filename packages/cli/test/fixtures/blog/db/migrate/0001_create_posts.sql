create table if not exists posts (
  id integer primary key autoincrement,
  title text not null,
  body text,
  published integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);

insert into posts (title, body, published, created_at, updated_at)
values ('First post', 'Hello from the JOT end-to-end test.', 1, 1750000000000, 1750000000000);

-- jot:down
drop table if exists posts;
