import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { q, exec, js } from "../db.js";
import { stringCorretor } from "./supabase.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PYTHON = process.env.PYTHON_BIN || path.join(RAIZ, ".venv", "bin", "python");
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const SIMULTANEAS = Number(process.env.CORRECOES_SIMULTANEAS || 2);
const TIMEOUT_MS = 240_000;
// O corretor abre páginas e bancos de terceiros: roda como usuário sem privilégios (ex.: www).
const UID = process.env.CORRETOR_UID ? Number(process.env.CORRETOR_UID) : undefined;
const GID = process.env.CORRETOR_GID ? Number(process.env.CORRETOR_GID) : undefined;

export interface ResultadoCorretor {
  nota_banco: number | null; nota_front: number | null; alerta: string; erro: string;
  detalhes: { banco?: any[]; front?: any[] };
}

/** Roda corretor.py --json (ou --ping) com a entrada em JSON pelo stdin. */
export function rodarCorretor(modo: "--json" | "--ping", entrada: object): Promise<any> {
  return new Promise(resolve => {
    const p = spawn(PYTHON, [path.join(RAIZ, "corretor", "corretor.py"), modo], {
      cwd: RAIZ, uid: UID, gid: GID,
      env: {
        PATH: `${path.dirname(NODE_BIN)}:/usr/bin:/bin`, HOME: "/tmp", LANG: "C.UTF-8",
        NODE_BIN, PLAYWRIGHT_BROWSERS_PATH: path.join(RAIZ, "corretor", ".browsers"),
        ...(process.env.LABBD_PERMITIR_LOCAL === "1" ? { LABBD_PERMITIR_LOCAL: "1" } : {}),
      },
    });
    let out = "", err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), TIMEOUT_MS);
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { err += d; });
    p.on("close", code => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out.trim().split("\n").pop() || "")); }
      catch { resolve({ nota_banco: null, nota_front: null, alerta: "", erro: code === null ? "correção passou do tempo limite" : "falha no corretor: " + (err || out).slice(-300), detalhes: {} }); }
    });
    p.stdin.end(JSON.stringify(entrada));
  });
}

async function processar(c: any) {
  const e = (await q("SELECT * FROM bd_entregas WHERE id=?", [c.entrega_id]))[0];
  if (!e || !e.projeto_ref) {
    await exec("UPDATE bd_correcoes SET status='erro', erro=?, terminado_em=NOW() WHERE id=?", ["entrega sem string de conexão", c.id]);
    return;
  }
  const conn = stringCorretor({ ref: e.projeto_ref, host: e.pooler_host, porta: e.pooler_porta }, e.matricula);
  if (c.tipo === "ping") {
    const r = await rodarCorretor("--ping", { string_conexao: conn });
    if (r?.ok) await exec("UPDATE bd_entregas SET ultimo_contato=NOW() WHERE id=?", [e.id]);
    await exec("UPDATE bd_correcoes SET status=?, erro=?, terminado_em=NOW() WHERE id=?", [r?.ok ? "ok" : "erro", r?.erro || null, c.id]);
    return;
  }
  const r: ResultadoCorretor = await rodarCorretor("--json", {
    matricula: e.matricula, turma: e.tipo, string_conexao: conn, url_pagina: e.tipo === "N2" ? e.url_pagina || "" : "",
  });
  if (r.nota_banco !== null) await exec("UPDATE bd_entregas SET ultimo_contato=NOW() WHERE id=?", [e.id]);
  await exec(
    "UPDATE bd_correcoes SET status='ok', nota_banco=?, nota_front=?, alerta=?, erro=?, detalhes=?, terminado_em=NOW() WHERE id=?",
    [r.nota_banco, r.nota_front, r.alerta || null, (r.erro || "").slice(0, 500) || null, JSON.stringify(r.detalhes || {}), c.id]);
}

let rodando = 0;
async function tick() {
  while (rodando < SIMULTANEAS) {
    const prox = (await q("SELECT * FROM bd_correcoes WHERE status='fila' ORDER BY (tipo='previa') DESC, id LIMIT 1"))[0];
    if (!prox) return;
    const ok = await exec("UPDATE bd_correcoes SET status='rodando', iniciado_em=NOW() WHERE id=? AND status='fila'", [prox.id]);
    if (!ok.affectedRows) continue;
    rodando++;
    processar(prox)
      .catch(async err => {
        console.error("correção", prox.id, err);
        await exec("UPDATE bd_correcoes SET status='erro', erro=?, terminado_em=NOW() WHERE id=?", [String(err).slice(0, 500), prox.id]);
      })
      .finally(() => { rodando--; });
  }
}

/** Ao fechar o prazo, enfileira a correção final de todas as entregas (uma vez). */
async function finaisAutomaticas() {
  const fechadas = await q("SELECT id FROM bd_avaliacoes WHERE fecha_em <= NOW() AND final_enfileirada_em IS NULL");
  for (const a of fechadas) {
    await enfileirarFinais(a.id, "sistema");
    await exec("UPDATE bd_avaliacoes SET final_enfileirada_em=NOW() WHERE id=?", [a.id]);
  }
}

export async function enfileirarFinais(avaliacaoId: number, por: string) {
  const r = await exec(
    `INSERT INTO bd_correcoes (entrega_id, tipo, solicitado_por)
     SELECT e.id, 'final', ? FROM bd_entregas e
      WHERE e.avaliacao_id=? AND e.projeto_ref IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM bd_correcoes c WHERE c.entrega_id=e.id AND c.tipo='final' AND c.status IN ('fila','rodando'))`,
    [por, avaliacaoId]);
  return r.affectedRows;
}

/**
 * Projetos gratuitos do Supabase pausam depois de alguns dias sem uso. Uma vez por dia,
 * enquanto a avaliação estiver aberta ou nos 21 dias depois do prazo, faz um SELECT 1 em cada banco.
 */
async function pingsDiarios() {
  await exec(
    `INSERT INTO bd_correcoes (entrega_id, tipo, solicitado_por)
     SELECT e.id, 'ping', 'sistema' FROM bd_entregas e JOIN bd_avaliacoes a ON a.id=e.avaliacao_id
      WHERE e.projeto_ref IS NOT NULL AND a.abre_em <= NOW() AND a.fecha_em >= NOW() - INTERVAL 21 DAY
        AND (e.ultimo_contato IS NULL OR e.ultimo_contato < NOW() - INTERVAL 20 HOUR)
        AND NOT EXISTS (SELECT 1 FROM bd_correcoes c WHERE c.entrega_id=e.id AND c.tipo='ping'
                         AND (c.status IN ('fila','rodando') OR c.criado_em > NOW() - INTERVAL 20 HOUR))`);
}

export function iniciarCorretor() {
  setInterval(() => { tick().catch(e => console.error("fila", e)); }, 2000);
  setInterval(() => { finaisAutomaticas().catch(e => console.error("finais", e)); }, 60_000);
  setInterval(() => { pingsDiarios().catch(e => console.error("pings", e)); }, 30 * 60_000);
  pingsDiarios().catch(e => console.error("pings", e));
}

export function resumo(c: any, mostrarNota: boolean) {
  if (!c) return null;
  const det = js<any>(c.detalhes, {});
  const tira = (itens: any[] = []) => itens.map(i => mostrarNota ? i : { item: i.item, ok: i.ok, obs: i.obs });
  return {
    id: c.id, tipo: c.tipo, status: c.status, criado_em: c.criado_em, terminado_em: c.terminado_em,
    nota_banco: mostrarNota ? c.nota_banco : undefined, nota_front: mostrarNota ? c.nota_front : undefined,
    alerta: c.alerta, erro: c.erro, banco: tira(det.banco), front: tira(det.front),
  };
}
