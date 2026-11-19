-- Slipp's data, in its own schema. Safe to run more than once.
create schema if not exists slipp;
set search_path to slipp;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  currency text not null default '₦',
  phone text not null default '',
  address text not null default '',
  bank text not null default '',          -- "GTBank · 0123456789 · Ada Stores", printed on invoices
  invoice_seq integer not null default 0,
  created_at timestamptz not null default now()
);

-- A chat that belongs to a business owner: a WhatsApp number or a Telegram chat.
create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'telegram')),
  address text not null,                  -- WhatsApp number (digits) or Telegram chat id
  display_name text not null default '',
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel, address)
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists customers_name on customers (business_id, lower(name));

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  price numeric(14,2),
  stock integer,                          -- null means stock is not tracked
  low_stock integer not null default 3,
  low_alerted boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists products_name on products (business_id, lower(name));

-- Invoices and receipts are the same record: a receipt is a paid invoice.
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  number text not null,
  customer_id uuid references customers(id) on delete set null,
  customer_name text not null default '',
  customer_phone text not null default '',
  items jsonb not null,                   -- [[name, qty, price], ...]
  total numeric(14,2) not null,
  status text not null check (status in ('paid', 'unpaid')),
  method text not null default '',
  note text not null default '',
  due_date date,
  paid_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, number)
);
create index if not exists invoices_business_created on invoices (business_id, created_at desc);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  description text not null,
  category text not null default '',
  amount numeric(14,2) not null,
  spent_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists expenses_business_spent on expenses (business_id, spent_on desc);

-- Recent conversation, so the assistant remembers the last few turns.
create table if not exists messages (
  id bigserial primary key,
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_chat on messages (chat_id, id desc);

-- WhatsApp and Telegram can deliver the same message twice; each is handled once.
create table if not exists seen_updates (
  key text primary key,
  created_at timestamptz not null default now()
);
