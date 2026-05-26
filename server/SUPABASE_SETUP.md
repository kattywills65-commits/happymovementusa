# Supabase Setup Guide — HappyMovement USA

## 1. Create a Supabase Project

1. Go to https://supabase.com and sign in
2. Click **New Project**, give it a name (e.g. `happymovementusa`)
3. Set a strong database password and choose your region
4. Wait for the project to finish provisioning

## 2. Get Your Credentials

Go to **Project Settings → API** and copy:
- **Project URL** → paste as `SUPABASE_URL` in `.env`
- **service_role secret** (not anon) → paste as `SUPABASE_KEY` in `.env`

> Use the `service_role` key for the backend — it bypasses Row Level Security so your server has full access.

---

## 3. Create the Tables

Go to **SQL Editor** in your Supabase dashboard and run the following SQL blocks.

### Table: users

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz default now()
);
```

### Table: applications

```sql
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'under_review')),
  loan_balance numeric not null,
  loan_type text not null,
  lender text not null,
  monthly_payment numeric,
  hardship_reason text not null,
  income numeric not null,
  relief_rate numeric default 50,
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### Auto-update `updated_at` on changes

```sql
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at
before update on applications
for each row execute function update_updated_at();
```

---

## 4. Disable Row Level Security (for service_role backend)

Since the backend uses the `service_role` key, RLS policies are bypassed automatically. You can leave RLS off on both tables, or enable it and add permissive policies — your choice.

To keep things simple, run:

```sql
alter table users disable row level security;
alter table applications disable row level security;
```

---

## 5. Create an Admin User

After starting the server, register a normal user via `POST /api/auth/register`, then promote them to admin in Supabase:

```sql
update users set role = 'admin' where username = 'your_admin_username';
```

---

## 6. Summary of Tables

| Table        | Key Columns                                                                 |
|--------------|-----------------------------------------------------------------------------|
| users        | id, username, password_hash, role, created_at                              |
| applications | id, user_id, status, loan_balance, loan_type, lender, monthly_payment, hardship_reason, income, relief_rate, admin_notes, created_at, updated_at |

---

## 7. API Routes Reference

| Method | Route                          | Auth         | Description                        |
|--------|--------------------------------|--------------|------------------------------------|
| POST   | /api/auth/register             | None         | Register with username + password  |
| POST   | /api/auth/login                | None         | Login, returns JWT                 |
| POST   | /api/applications              | Bearer token | Submit application                 |
| GET    | /api/applications/me           | Bearer token | Get your own application           |
| GET    | /api/admin/applications        | Admin token  | Get all applications               |
| PATCH  | /api/admin/applications/:id    | Admin token  | Update status, relief_rate, notes  |
