#!/usr/bin/env bash
# Stack Supabase locale pour les tests e2e, sans la CLI Supabase : base (image
# supabase/postgres), auth (binaire officiel), API REST (PostgREST), passerelle,
# edge functions servies par Deno et faux prestataires. Voir README.md.
# Rejouable : ne refait que ce qui manque. Jamais de connexion à la production.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
STATE=${E2E_STACK_DIR:-/tmp/konekt-e2e-stack}
PG_IMAGE=${E2E_PG_IMAGE:-supabase/postgres:17.6.1.106}
REST_IMAGE=${E2E_REST_IMAGE:-postgrest/postgrest:v14.8}
AUTH_VERSION=${E2E_AUTH_VERSION:-v2.188.1}
JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
DB_PORT=54322
mkdir -p "$STATE"
export PGPASSWORD=postgres
psql_admin() { psql -h 127.0.0.1 -p $DB_PORT -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_pg() { psql -h 127.0.0.1 -p $DB_PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
stop_pid() { [ -f "$STATE/$1.pid" ] && kill "$(cat "$STATE/$1.pid")" 2>/dev/null || true; rm -f "$STATE/$1.pid"; }

# 1. Base
if docker ps -a --format '{{.Names}}' | grep -qx konekt-e2e-db; then
  docker start konekt-e2e-db >/dev/null
else
  docker run -d --name konekt-e2e-db -p $DB_PORT:5432 -e POSTGRES_PASSWORD=postgres \
    -e JWT_SECRET=$JWT_SECRET -e JWT_EXP=3600 "$PG_IMAGE" \
    postgres -c config_file=/etc/postgresql/postgresql.conf >/dev/null
fi
for _ in $(seq 1 60); do psql_admin -Atc 'select 1' >/dev/null 2>&1 && break; sleep 1; done
psql_admin -c "alter role authenticator with password 'postgres'; alter role supabase_auth_admin with password 'postgres'; alter role supabase_storage_admin with password 'postgres';"

# 2. Auth (binaire de la release GitHub : les images du registre sont souvent limitées)
if [ ! -x "$STATE/auth/auth" ]; then
  mkdir -p "$STATE/auth"
  curl -fsSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar xz -C "$STATE/auth"
fi
stop_pid auth
(
  cd "$STATE/auth"
  env GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
    API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
    GOTRUE_DB_DRIVER=postgres \
    GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:$DB_PORT/postgres?search_path=auth" \
    GOTRUE_DB_NAMESPACE=auth GOTRUE_SITE_URL=http://localhost:8080 GOTRUE_URI_ALLOW_LIST='http://localhost:8080/**' \
    GOTRUE_JWT_SECRET=$JWT_SECRET GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
    GOTRUE_JWT_ISSUER=http://127.0.0.1:54321/auth/v1 GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
    GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_PHONE_ENABLED=false GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 \
    GOTRUE_RATE_LIMIT_VERIFY=10000 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=10000 GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS=10000 \
    GOTRUE_LOG_LEVEL=warn nohup ./auth > "$STATE/auth.log" 2>&1 &
  echo $! > "$STATE/auth.pid"
)
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:9999/health >/dev/null 2>&1 && break; sleep 1; done

# 3. Stockage minimal (tables créées d'ordinaire par le service de stockage, absent ici) puis migrations
if [ "$(psql_admin -Atc "select to_regclass('storage.buckets') is null")" = "t" ]; then
  psql_admin <<'SQL'
SET ROLE supabase_storage_admin;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL UNIQUE, owner uuid, owner_id text, public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], type text DEFAULT 'STANDARD',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text,
  owner uuid, owner_id text, metadata jsonb, user_metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED, version text, level int,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT reverse(split_part(reverse(storage.filename(name)), '.', 1)) $$;
GRANT ALL ON storage.objects, storage.buckets TO postgres, anon, authenticated, service_role;
RESET ROLE;
SQL
fi
if [ "$(psql_pg -Atc "select to_regclass('public.outreach_sequences') is null")" = "t" ]; then
  # Même rôle que la CLI (postgres, non superutilisateur), un fichier par transaction.
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql_pg -1 -f "$f" > "$STATE/migration.log" 2>&1 || { echo "migration en échec : $f"; tail -5 "$STATE/migration.log"; exit 1; }
  done
fi

# 4. API REST
docker rm -f konekt-e2e-rest >/dev/null 2>&1 || true
docker run -d --name konekt-e2e-rest --network host \
  -e PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:$DB_PORT/postgres" \
  -e PGRST_DB_SCHEMAS=public,graphql_public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$JWT_SECRET \
  -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions -e PGRST_DB_MAX_ROWS=1000 \
  -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT=3000 "$REST_IMAGE" >/dev/null

# 5. Clés, passerelle, faux prestataires, edge functions
KEYS=$(node -e '
const c=require("crypto"),s=process.argv[1],b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const sign=p=>{const h=b({alg:"HS256",typ:"JWT"}),q=b(p);return h+"."+q+"."+c.createHmac("sha256",s).update(h+"."+q).digest("base64url")};
const exp=Math.floor(Date.now()/1000)+10*365*86400;
console.log(sign({iss:"supabase-demo",role:"anon",exp})+" "+sign({iss:"supabase-demo",role:"service_role",exp}));' "$JWT_SECRET")
ANON_KEY=${KEYS% *}; SERVICE_ROLE_KEY=${KEYS#* }
stop_pid gateway; stop_pid vendor-mock; stop_pid functions
nohup node "$HERE/gateway.mjs" > "$STATE/gateway.log" 2>&1 & echo $! > "$STATE/gateway.pid"
nohup node "$HERE/vendor-mock.mjs" > "$STATE/vendor-mock.log" 2>&1 & echo $! > "$STATE/vendor-mock.pid"
DENO_BIN=${DENO_BIN:-$(command -v deno || true)}
[ -n "$DENO_BIN" ] || DENO_BIN="npx -y deno"
CERT=${DENO_CERT:-${SSL_CERT_FILE:-${NODE_EXTRA_CA_CERTS:-}}}
CERT_ENV=(); [ -n "$CERT" ] && CERT_ENV=(DENO_CERT="$CERT")
env SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  SUPABASE_DB_URL="postgres://postgres:postgres@127.0.0.1:$DB_PORT/postgres" \
  UNIPILE_API_KEY=mock-key UNIPILE_DSN=unipile.mock ANTHROPIC_API_KEY=mock-key \
  PROCESS_SEQUENCES_SECRET=local-cron-secret UNIPILE_WEBHOOK_SECRET=local-webhook-secret \
  SEQUENCE_WEBHOOK_SECRET=local-sequence-webhook-secret EMAIL_LINK_SIGNING_SECRET=local-link-secret \
  ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080 APP_URL=http://localhost:8080 \
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost "${CERT_ENV[@]}" \
  nohup $DENO_BIN run -A --no-check --import-map="$HERE/import_map.json" "$HERE/functions-server.ts" \
  > "$STATE/functions.log" 2>&1 & echo $! > "$STATE/functions.pid"
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:54321/auth/v1/health >/dev/null 2>&1 && break; sleep 1; done

cat > "$STATE/env" <<ENV
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_ANON_KEY=$ANON_KEY
E2E_SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
E2E_ALLOW_SEEDING=1
E2E_EDGE_FUNCTIONS=1
E2E_VENDOR_MOCK_URL=http://127.0.0.1:54340
E2E_PROCESS_SEQUENCES_SECRET=local-cron-secret
E2E_UNIPILE_WEBHOOK_SECRET=local-webhook-secret
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
NO_PROXY=127.0.0.1,localhost
no_proxy=127.0.0.1,localhost
ENV
echo "Stack prête. Variables : $STATE/env (set -a; . $STATE/env; set +a)"
