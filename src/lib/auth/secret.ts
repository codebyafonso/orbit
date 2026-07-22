/**
 * Chaves simetricas vindas do ambiente. Centralizado porque `crypto.ts` e
 * `session.ts` usam segredos distintos com a mesma regra — duas copias da
 * validacao acabariam divergindo.
 *
 * Buffer.from(x, "hex") nao lanca com lixo: para no primeiro par invalido e
 * devolve uma chave curta em silencio. Por isso o formato inteiro e validado.
 */
export function hexKey(envName: string): Buffer {
  const value = process.env[envName];
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${envName} deve ter 32 bytes em hex (64 caracteres)`);
  }
  return Buffer.from(value, "hex");
}
