// Cliente HTTP: as rotas já incluem /api uma única vez.
export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) { super(message); }
}

export function makeApi(tokenKey: string) {
  const getToken = () => { try { return localStorage.getItem(tokenKey); } catch { return null; } };
  const setToken = (t: string | null) => { try { t ? localStorage.setItem(tokenKey, t) : localStorage.removeItem(tokenKey); } catch { /* ignore */ } };
  async function call<T = any>(method: string, path: string, body?: any): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const t = getToken();
    if (t) headers.authorization = `Bearer ${t}`;
    let res: Response;
    try {
      res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new ApiError(0, "Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.status === 401 && t) setToken(null);
    if (!res.ok) throw new ApiError(res.status, data?.message || `Erro ${res.status}`, data);
    return data as T;
  }
  /** Baixa um arquivo autenticado (ex.: carga .sql, CSV de notas). */
  async function download(path: string, nome: string) {
    const t = getToken();
    const res = await fetch(`/api${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return {
    getToken, setToken, download,
    get: <T = any>(p: string) => call<T>("GET", p),
    post: <T = any>(p: string, b: any = {}) => call<T>("POST", p, b),
    put: <T = any>(p: string, b: any = {}) => call<T>("PUT", p, b),
  };
}

export const alunoApi = makeApi("labbd_token");
export const adminApi = makeApi("labbd_admin_token");

export const fmtNota = (v: any) => (v === null || v === undefined || v === "" ? "–" : Number(v).toFixed(2).replace(".", ","));
export const fmtData = (v: any) => (!v ? "–" : new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }));

export const ITENS: Record<string, string> = {
  carga_do_aluno: "Carga da sua matrícula",
  vw_eleitores_pendentes: "View 1 · vw_eleitores_pendentes",
  vw_candidatos_por_chapa: "View 2 · vw_candidatos_por_chapa",
  vw_apuracao: "View 3 · vw_apuracao",
  vw_comparecimento_setor: "View 4 · vw_comparecimento_setor",
  vw_chapa_vencedora: "View 5 · vw_chapa_vencedora",
  vw_votos_por_hora: "View 6 · vw_votos_por_hora",
  t7_sem_duplicados: "Tarefa 7 · sem votos duplicados",
  t7_regra_unique: "Tarefa 7 · regra UNIQUE (id_eleitor)",
  t7_sem_perda_de_votos: "Tarefa 7 · nenhum voto legítimo apagado",
  front_pagina_abre: "Página abre sem erro",
  front_apuracao: "Apuração igual à do banco",
  front_candidatos: "Candidatos iguais aos do banco",
  front_cadastro: "Cadastro de eleitor gravado",
  front_rls: "RLS ativo nas 5 tabelas",
};
