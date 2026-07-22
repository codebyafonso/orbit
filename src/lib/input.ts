/**
 * Validacao de fronteira para corpos JSON.
 *
 * `as { email?: string }` e uma promessa vazia: um corpo com `{"email":{"a":1}}`
 * atravessa o cast e so quebra la dentro, virando 500 com stack em vez de 400.
 */
export function asString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Segredos nao levam trim: espacos fazem parte da senha que o usuario escolheu. */
export function asSecret(value: unknown, { min, max }: { min: number; max: number }): string | null {
  if (typeof value !== "string") return null;
  if (value.length < min || value.length > max) return null;
  return value;
}

export const LIMITES = {
  email: 254,
  senha: 1024,
  token: 512,
  teamId: 128,
} as const;
