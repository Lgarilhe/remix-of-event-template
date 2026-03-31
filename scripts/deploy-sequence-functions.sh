#!/bin/bash
# ============================================================================
# Deploy script for Sequence Module edge functions
#
# Prerequisites:
#   - Supabase CLI installed: npm install -g supabase
#   - Logged in: supabase login
#   - Linked: supabase link --project-ref vprofpsxzmtndzbrscrq
#
# Usage:
#   chmod +x scripts/deploy-sequence-functions.sh
#   ./scripts/deploy-sequence-functions.sh
# ============================================================================

set -e

PROJECT_REF="vprofpsxzmtndzbrscrq"

echo "=== Deploying Sequence Module Edge Functions ==="
echo "Project: $PROJECT_REF"
echo ""

# List of new functions to deploy
FUNCTIONS=(
  "sequence-send-email"
  "sequence-email-track"
  "sequence-webhooks-handler"
  "sequence-templates-crud"
  "sequence-snippets-crud"
)

# Also redeploy the modified function
MODIFIED_FUNCTIONS=(
  "process-sequences"
)

echo "--- Deploying NEW functions ---"
for fn in "${FUNCTIONS[@]}"; do
  echo "Deploying $fn..."
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt 2>&1 || {
    echo "  WARNING: Failed to deploy $fn. Retrying in 3s..."
    sleep 3
    supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt
  }
  echo "  Done: $fn"
done

echo ""
echo "--- Redeploying MODIFIED functions ---"
for fn in "${MODIFIED_FUNCTIONS[@]}"; do
  echo "Deploying $fn..."
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt 2>&1 || {
    echo "  WARNING: Failed to deploy $fn. Retrying in 3s..."
    sleep 3
    supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt
  }
  echo "  Done: $fn"
done

echo ""
echo "=== All functions deployed ==="
echo ""
echo "Next steps:"
echo "  1. Run the migration SQL in Supabase SQL Editor"
echo "  2. Run the seed data: scripts/seed-sequence-data.sql"
echo "  3. Set up webhooks: UNIPILE_BASE_URL=... npx ts-node scripts/setup-sequence-webhooks.ts"
