# Deploy Edge Functions

Identify which Supabase edge functions have been modified and provide the deployment commands.

## Steps

1. Run `git diff --name-only origin/main -- supabase/functions/` to find modified edge functions relative to main.
2. If no diff against main, run `git diff --name-only HEAD~5 -- supabase/functions/` to check recent commits.
3. Extract the unique function directory names from the changed files (ignore `_shared/`).
4. If `_shared/` files were modified, warn that ALL functions using those shared modules should be redeployed.
5. For each modified function, output the deploy command:
   ```
   supabase functions deploy {function-name}
   ```
6. If multiple functions, also provide a single-line command to deploy all at once:
   ```
   supabase functions deploy func1 && supabase functions deploy func2
   ```

## Important reminders
- Edge functions are NOT auto-deployed by Lovable — only the frontend is.
- After deploying, verify the function works by checking Supabase logs.
- If `_shared/` was modified, the affected functions are: all functions that import from `_shared/`. List the most commonly affected ones: `generate-search-filters`, `score-profile-job`, `database-search`, `enrich-contact`, `unipile-search`.
