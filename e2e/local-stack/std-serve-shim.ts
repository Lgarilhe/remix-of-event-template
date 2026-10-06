// Remplace https://deno.land/std@0.224.0/http/server.ts (hôte bloqué par le proxy local).
// deno-lint-ignore no-explicit-any
export function serve(handler: any, options: any = {}) {
  return Deno.serve(options, handler);
}
