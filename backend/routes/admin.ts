import { Router } from "express";
import bcrypt from "bcryptjs";
import { q, exec, eq, js, logEvento } from "../db.js";
import { requireAdmin, signAdmin, clientIp, AdminToken } from "../security.js";
import { stringVisivel } from "../services/supabase.js";
import { cargaDoAluno } from "../services/carga.js";
import { enfileirarFinais, resumo } from "../services/correcao.js";

const r = Router();

r.post("/login", async (req, res) => {
  const ip = clientIp(req);
  const id = String(req.body?.identificador || "").trim();
  const senha = String(req.body?.senha || "");
  if (!id || !senha) return res.status(400).json({ message: "Informe e-mail e senha." });
  const falhas = await q("SELECT COUNT(*) n FROM bd_eventos WHERE tipo='admin_login_falha' AND detalhe=? AND criado_em > NOW() - INTERVAL 15 MINUTE", [id]);
  if (Number(falhas[0].n) >= 5) return res.status(429).json({ message: "Muitas tentativas. Aguarde 15 minutos." });
  const u = (await eq("SELECT id, name, role, password FROM users WHERE role IN ('teacher','admin') AND (email=? OR registration=?) LIMIT 1", [id, id]))[0];
  if (!u || !(await bcrypt.compare(senha, u.password))) {
    await logEvento("admin_login_falha", id, { ip });
    return res.status(401).json({ message: "Credenciais inválidas (use a conta de professor do EduTest)." });
  }
  await logEvento("admin_login_ok", id, { ip, userId: u.id });
  res.json({ token: signAdmin({ uid: u.id, nome: u.name, role: u.role }), nome: u.name });
});

r.use(requireAdmin);

r.get("/turmas", async (req, res) => {
  const a = (req as any).admin as AdminToken;
  const rows = await eq(
    `SELECT s.id, s.name, (SELECT COUNT(*) FROM enrollments en WHERE en.subject_id=s.id) AS alunos
       FROM subjects s ${a.role === "admin" ? "" : "WHERE s.teacher_id=?"} ORDER BY s.name`, a.role === "admin" ? [] : [a.uid]);
  res.json(rows);
});

// ---------- Avaliações ----------
function corpo(b: any) {
  const titulo = String(b?.titulo || "").trim();
  const turmas = (Array.isArray(b?.turmas) ? b.turmas : [])
    .map((t: any) => ({ subject_id: Number(t.subject_id), tipo: t.tipo === "N2" ? "N2" : "N1" }))
    .filter((t: any) => Number.isInteger(t.subject_id));
  const abre = new Date(b?.abre_em), fecha = new Date(b?.fecha_em);
  const limite = Number(b?.limite_dia ?? 15);
  if (!titulo) throw new Error("Informe o título.");
  if (!turmas.length) throw new Error("Escolha ao menos uma turma.");
  if (isNaN(abre.getTime()) || isNaN(fecha.getTime()) || fecha <= abre) throw new Error("Datas inválidas: o prazo precisa ser depois da abertura.");
  if (!Number.isInteger(limite) || limite < 0 || limite > 100) throw new Error("Limite diário inválido (0 a 100).");
  return { titulo, turmas, abre, fecha, limite, mostrar: b?.mostrar_nota ? 1 : 0, liberadas: b?.notas_liberadas ? 1 : 0 };
}

const listarAvaliacao = (av: any) => ({ ...av, turmas: js(av.turmas, []), mostrar_nota: !!av.mostrar_nota, notas_liberadas: !!av.notas_liberadas });

r.get("/avaliacoes", async (_req, res) => {
  res.json((await q("SELECT * FROM bd_avaliacoes ORDER BY fecha_em DESC")).map(listarAvaliacao));
});

r.post("/avaliacoes", async (req, res) => {
  const a = (req as any).admin as AdminToken;
  try {
    const c = corpo(req.body);
    const x = await exec("INSERT INTO bd_avaliacoes (titulo, turmas, abre_em, fecha_em, limite_dia, mostrar_nota, notas_liberadas, criado_por) VALUES (?,?,?,?,?,?,?,?)",
      [c.titulo, JSON.stringify(c.turmas), c.abre, c.fecha, c.limite, c.mostrar, c.liberadas, a.uid]);
    res.json({ id: x.insertId });
  } catch (e: any) { res.status(400).json({ message: e.message }); }
});

r.put("/avaliacoes/:id", async (req, res) => {
  try {
    const c = corpo(req.body);
    const antes = (await q("SELECT * FROM bd_avaliacoes WHERE id=?", [Number(req.params.id)]))[0];
    if (!antes) return res.status(404).json({ message: "Avaliação não encontrada." });
    // prazo reaberto/estendido: a correção final automática volta a valer para o novo prazo
    const reabre = c.fecha > new Date() ? ", final_enfileirada_em=NULL" : "";
    await exec(`UPDATE bd_avaliacoes SET titulo=?, turmas=?, abre_em=?, fecha_em=?, limite_dia=?, mostrar_nota=?, notas_liberadas=?${reabre} WHERE id=?`,
      [c.titulo, JSON.stringify(c.turmas), c.abre, c.fecha, c.limite, c.mostrar, c.liberadas, antes.id]);
    res.json({ ok: true });
  } catch (e: any) { res.status(400).json({ message: e.message }); }
});

/** Alunos das turmas da avaliação, com entrega, última verificação e correção final. */
async function painel(avId: number) {
  const av = (await q("SELECT * FROM bd_avaliacoes WHERE id=?", [avId]))[0];
  if (!av) return null;
  const turmas = js<any[]>(av.turmas, []);
  const tipoDe = new Map(turmas.map(t => [Number(t.subject_id), t.tipo]));
  const ids = [...tipoDe.keys()];
  const alunos = ids.length ? await eq(
    `SELECT u.id, u.name, u.registration, en.subject_id, s.name AS turma
       FROM enrollments en JOIN users u ON u.id=en.student_id JOIN subjects s ON s.id=en.subject_id
      WHERE en.subject_id IN (?) AND u.role='student' ORDER BY u.name`, [ids]) : [];
  const entregas = new Map((await q("SELECT * FROM bd_entregas WHERE avaliacao_id=?", [avId])).map(e => [e.user_id, e]));
  const ultimas = await q(
    `SELECT c.* FROM bd_correcoes c JOIN bd_entregas e ON e.id=c.entrega_id
      WHERE e.avaliacao_id=? AND c.tipo IN ('previa','final')
        AND c.id = (SELECT MAX(c2.id) FROM bd_correcoes c2 WHERE c2.entrega_id=c.entrega_id AND c2.tipo=c.tipo)`, [avId]);
  const porEntrega = new Map<number, any>();
  for (const c of ultimas) porEntrega.set(c.entrega_id, { ...(porEntrega.get(c.entrega_id) || {}), [c.tipo]: c });
  const vistos = new Map<number, any>();
  for (const al of alunos) {
    const tipo = tipoDe.get(Number(al.subject_id));
    const atual = vistos.get(al.id);
    if (atual && !(tipo === "N2" && atual.tipo !== "N2")) continue;   // matriculado nas duas: vale a N2
    const e = entregas.get(al.id);
    const cs = e ? porEntrega.get(e.id) || {} : {};
    vistos.set(al.id, {
      user_id: al.id, nome: al.name, matricula: al.registration, turma: al.turma, tipo,
      entrega: e ? {
        id: e.id, conexao: e.projeto_ref ? stringVisivel({ ref: e.projeto_ref, host: e.pooler_host, porta: e.pooler_porta }) : null,
        url_pagina: e.url_pagina, atualizado_em: e.atualizado_em, ultimo_contato: e.ultimo_contato,
      } : null,
      previa: resumo(cs.previa, true), final: resumo(cs.final, true),
    });
  }
  const fila = (await q(
    `SELECT c.status, COUNT(*) n FROM bd_correcoes c JOIN bd_entregas e ON e.id=c.entrega_id
      WHERE e.avaliacao_id=? AND c.status IN ('fila','rodando') AND c.tipo<>'ping' GROUP BY c.status`, [avId]))
    .reduce((acc: any, x: any) => ({ ...acc, [x.status]: Number(x.n) }), {});
  return { avaliacao: listarAvaliacao(av), alunos: [...vistos.values()], fila };
}

r.get("/avaliacoes/:id/painel", async (req, res) => {
  const p = await painel(Number(req.params.id));
  if (!p) return res.status(404).json({ message: "Avaliação não encontrada." });
  res.json(p);
});

r.post("/avaliacoes/:id/corrigir-todos", async (req, res) => {
  const a = (req as any).admin as AdminToken;
  const n = await enfileirarFinais(Number(req.params.id), "professor");
  await logEvento("corrigir_todos", String(req.params.id), { userId: a.uid, ip: clientIp(req) });
  res.json({ enfileiradas: n });
});

r.post("/entregas/:id/corrigir", async (req, res) => {
  const e = (await q("SELECT * FROM bd_entregas WHERE id=?", [Number(req.params.id)]))[0];
  if (!e?.projeto_ref) return res.status(400).json({ message: "Entrega sem string de conexão." });
  const pend = await q("SELECT id FROM bd_correcoes WHERE entrega_id=? AND tipo='final' AND status IN ('fila','rodando')", [e.id]);
  if (!pend.length) await exec("INSERT INTO bd_correcoes (entrega_id, tipo, solicitado_por) VALUES (?, 'final', 'professor')", [e.id]);
  res.json({ ok: true });
});

r.get("/entregas/:id/historico", async (req, res) => {
  const cs = await q("SELECT * FROM bd_correcoes WHERE entrega_id=? AND tipo IN ('previa','final') ORDER BY id DESC LIMIT 30", [Number(req.params.id)]);
  res.json(cs.map(c => resumo(c, true)));
});

const csvCampo = (v: any) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

r.get("/avaliacoes/:id/csv", async (req, res) => {
  const p = await painel(Number(req.params.id));
  if (!p) return res.status(404).json({ message: "Avaliação não encontrada." });
  const linhas = [["matricula", "nome", "turma", "tipo", "entregou", "nota_banco", "nota_front", "alerta", "erro", "corrigido_em", "conexao", "url_pagina"]];
  for (const al of p.alunos) {
    const f = al.final;
    linhas.push([al.matricula, al.nome, al.turma, al.tipo, al.entrega?.conexao ? "sim" : "não",
      f?.nota_banco ?? "", al.tipo === "N2" ? f?.nota_front ?? "" : "", f?.alerta ?? "", f?.erro ?? "",
      f?.terminado_em ? new Date(f.terminado_em).toLocaleString("pt-BR") : "", al.entrega?.conexao ?? "", al.entrega?.url_pagina ?? ""]);
  }
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="notas_avaliacao_${p.avaliacao.id}.csv"`);
  res.send("﻿" + linhas.map(l => l.map(csvCampo).join(",")).join("\n"));
});

r.get("/carga/:matricula", async (req, res) => {
  const mat = String(req.params.matricula).replace(/\D/g, "");
  if (!mat) return res.status(400).json({ message: "Matrícula inválida." });
  res.setHeader("content-type", "application/sql; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="carga_${mat}.sql"`);
  res.send(await cargaDoAluno(mat));
});

export default r;
