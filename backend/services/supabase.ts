import { createHash } from "crypto";

/** Mesma senha que carga/gerar_carga.py coloca no usuário corretor daquela matrícula. */
export function senhaCorretor(matricula: string) {
  return "Cipa_" + createHash("sha256").update("corretor:" + matricula).digest("hex").slice(0, 12);
}

export interface Pooler { ref: string; host: string; porta: number }

const HOST = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;

/**
 * O aluno cola a URI do Session pooler como o Supabase mostra
 * (postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<região>.pooler.supabase.com:5432/postgres).
 * Guardamos só ref, host e porta: o usuário vira "corretor" e a senha sai da matrícula,
 * então nenhuma senha do aluno é armazenada.
 */
export function lerPooler(texto: string): { pooler?: Pooler; erro?: string; tinhaSenhaReal?: boolean } {
  const t = String(texto || "").trim();
  const m = t.match(/^postgres(?:ql)?:\/\/([^:@/\s]+)(?::([^@\s]*))?@([^:/\s?]+)(?::(\d+))?\/[^\s]*$/i);
  if (!m) return { erro: "Cole a string do Session pooler, começando com postgresql://" };
  const [, user, senha, hostRaw, portaRaw] = m;
  const host = hostRaw.toLowerCase();
  if (host.endsWith(".supabase.co")) {
    return { erro: "Essa é a conexão direta (db.….supabase.co). Use a do Session pooler (…pooler.supabase.com)." };
  }
  if (!HOST.test(host)) return { erro: "O endereço precisa ser do Session pooler do Supabase (…pooler.supabase.com)." };
  const um = user.match(/^(?:postgres|corretor)\.([a-z0-9]{20})$/i);
  if (!um) return { erro: "O usuário da string deve ser postgres.<ref-do-projeto> (como o Supabase mostra)." };
  const porta = Number(portaRaw || 5432);
  if (porta !== 5432 && porta !== 6543) return { erro: "Porta inválida: use 5432 (Session pooler)." };
  // Colou a senha do usuário postgres? Não guardamos, mas avisamos para trocar no Supabase.
  const tinhaSenhaReal = /^postgres\./i.test(user) && !!senha && !/^\[?your[-_ ]?password\]?$/i.test(senha);
  return { pooler: { ref: um[1].toLowerCase(), host, porta }, tinhaSenhaReal };
}

export function stringCorretor(p: Pooler, matricula: string) {
  // Só em teste automatizado (Postgres local): o banco pode ter outro nome.
  const banco = process.env.LABBD_PERMITIR_LOCAL === "1" && process.env.LABBD_TESTE_BANCO ? process.env.LABBD_TESTE_BANCO : "postgres";
  return `postgresql://corretor.${p.ref}:${encodeURIComponent(senhaCorretor(matricula))}@${p.host}:${p.porta}/${banco}`;
}

/** Versão para mostrar ao aluno/professor (sem senha). */
export function stringVisivel(p: Pooler) {
  return `postgresql://corretor.${p.ref}:••••••@${p.host}:${p.porta}/postgres`;
}
