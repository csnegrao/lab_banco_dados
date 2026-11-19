import { Router } from "express";
import bcrypt from "bcryptjs";
import { q, exec, eq, js, logEvento } from "../db.js";
import { requireAluno, signAluno, clientIp, normalizarMatricula, AlunoToken } from "../security.js";
import { lerPooler, stringVisivel } from "../services/supabase.js";
import { cargaDoAluno, enunciadoHtml } from "../services/carga.js";
import { resumo } from "../services/correcao.js";

const r = Router();
const MAX_FALHAS = 5, BLOQUEIO_MIN = 15, INTERVALO_VERIFICACAO_MIN = 3;

// ---------- Login com matrícula e senha do EduTest ----------
r.post("/auth/login", async (req, res) => {
  const ip = clientIp(req);
  const bruto = String(req.body?.matricula || "").trim();
  const senha = String(req.body?.senha || "");
  const mat = normalizarMatricula(bruto);
  if (!mat || !senha) return res.status(400).json({ message: "Informe matrícula e senha." });
  const falhas = await q("SELECT COUNT(*) n FROM bd_eventos WHERE tipo='login_falha' AND detalhe=? AND criado_em > NOW() - INTERVAL ? MINUTE", [mat, BLOQUEIO_MIN]);
  if (Number(falhas[0].n) >= MAX_FALHAS) return res.status(429).json({ message: `Muitas tentativas. Aguarde ${BLOQUEIO_MIN} minutos.` });
  const u = (await eq("SELECT id, name, registration, password FROM users WHERE role='student' AND registration IN (?, ?) LIMIT 1",
    [mat, bruto.replace(/\D/g, "")]))[0];
  if (!u || !(await bcrypt.compare(senha, u.password))) {
    await logEvento("login_falha", mat, { ip, userId: u?.id });
    return res.status(401).json({ message: "Matrícula ou senha incorretas. Use a mesma senha do EduTest (se nunca trocou, é a própria matrícula)." });
  }
  await logEvento("login_ok", mat, { ip, userId: u.id });
  res.json({ token: signAluno({ uid: u.id, mat: String(u.registration), nome: u.name }), nome: u.name, matricula: String(u.registration) });
});

// ---------- Avaliações do aluno ----------
interface AvaliacaoDoAluno { av: any; subject_id: number; tipo: "N1" | "N2" }

async function avaliacoesDoAluno(uid: number): Promise<AvaliacaoDoAluno[]> {
  const subjects = new Set((await eq("SELECT subject_id FROM enrollments WHERE student_id=?", [uid])).map(x => Number(x.subject_id)));
  const out: AvaliacaoDoAluno[] = [];
  for (const av of await q("SELECT * FROM bd_avaliacoes WHERE abre_em <= NOW() + INTERVAL 7 DAY ORDER BY fecha_em DESC")) {
    const turmas = js<any[]>(av.turmas, []).filter(t => subjects.has(Number(t.subject_id)));
    if (!turmas.length) continue;
    const t = turmas.find(x => x.tipo === "N2") || turmas[0];   // matriculado nas duas: vale a N2
    out.push({ av, subject_id: Number(t.subject_id), tipo: t.tipo === "N2" ? "N2" : "N1" });
  }
  return out;
}

async function avaliacaoDoAluno(uid: number, id: number) {
  return (await avaliacoesDoAluno(uid)).find(x => x.av.id === id) || null;
}

const aberta = (av: any) => new Date(av.abre_em) <= new Date() && new Date() < new Date(av.fecha_em);

async function estado(a: AvaliacaoDoAluno, s: AlunoToken) {
  const av = a.av;
  const e = (await q("SELECT * FROM bd_entregas WHERE avaliacao_id=? AND user_id=?", [av.id, s.uid]))[0];
  const previa = e ? (await q("SELECT * FROM bd_correcoes WHERE entrega_id=? AND tipo='previa' ORDER BY id DESC LIMIT 1", [e.id]))[0] : null;
  const final = e && av.notas_liberadas ? (await q("SELECT * FROM bd_correcoes WHERE entrega_id=? AND tipo='final' AND status='ok' ORDER BY id DESC LIMIT 1", [e.id]))[0] : null;
  const hoje = e ? Number((await q("SELECT COUNT(*) n FROM bd_correcoes WHERE entrega_id=? AND tipo='previa' AND criado_em >= CURDATE()", [e.id]))[0].n) : 0;
  const proxima = previa ? new Date(new Date(previa.criado_em).getTime() + INTERVALO_VERIFICACAO_MIN * 60_000) : null;
  return {
    id: av.id, titulo: av.titulo, tipo: a.tipo, abre_em: av.abre_em, fecha_em: av.fecha_em, aberta: aberta(av),
    ainda_nao_abriu: new Date(av.abre_em) > new Date(), mostrar_nota: !!av.mostrar_nota, notas_liberadas: !!av.notas_liberadas,
    entrega: e ? {
      conexao: e.projeto_ref ? stringVisivel({ ref: e.projeto_ref, host: e.pooler_host, porta: e.pooler_porta }) : null,
      url_pagina: e.url_pagina, atualizado_em: e.atualizado_em, ultimo_contato: e.ultimo_contato,
    } : null,
    previa: resumo(previa, !!av.mostrar_nota),
    final: resumo(final, true),
    verificacoes_hoje: hoje, limite_dia: av.limite_dia,
    proxima_verificacao: proxima && proxima > new Date() ? proxima : null,
  };
}

r.get("/painel", requireAluno, async (req, res) => {
  const s = (req as any).aluno as AlunoToken;
  const lista = await avaliacoesDoAluno(s.uid);
  res.json({ nome: s.nome, matricula: s.mat, avaliacoes: await Promise.all(lista.map(a => estado(a, s))) });
});

r.get("/avaliacoes/:id/enunciado", requireAluno, async (req, res) => {
  const s = (req as any).aluno as AlunoToken;
  const a = await avaliacaoDoAluno(s.uid, Number(req.params.id));
  if (!a || a.av.abre_em > new Date()) return res.status(404).json({ message: "Avaliação não disponível." });
  res.json({ html: enunciadoHtml(a.tipo) });
});

r.get("/avaliacoes/:id/carga", requireAluno, async (req, res) => {
  const s = (req as any).aluno as AlunoToken;
  const a = await avaliacaoDoAluno(s.uid, Number(req.params.id));
  if (!a || a.av.abre_em > new Date()) return res.status(404).json({ message: "Avaliação não disponível." });
  const sql = await cargaDoAluno(s.mat);
  await logEvento("carga_baixada", s.mat, { userId: s.uid, ip: clientIp(req) });
  res.setHeader("content-type", "application/sql; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="carga_${s.mat}.sql"`);
  res.send(sql);
});

r.put("/avaliacoes/:id/entrega", requireAluno, async (req, res) => {
  const s = (req as any).aluno as AlunoToken;
  const a = await avaliacaoDoAluno(s.uid, Number(req.params.id));
  if (!a) return res.status(404).json({ message: "Avaliação não encontrada." });
  if (!aberta(a.av)) return res.status(403).json({ message: "A entrega está fechada." });

  const textoConexao = String(req.body?.conexao || "").trim();
  const anterior = (await q("SELECT * FROM bd_entregas WHERE avaliacao_id=? AND user_id=?", [a.av.id, s.uid]))[0];
  // conexão em branco = mantém a já salva (o aluno só trocou o link da página)
  const lido: ReturnType<typeof lerPooler> = !textoConexao && anterior?.projeto_ref
    ? { pooler: { ref: anterior.projeto_ref, host: anterior.pooler_host, porta: anterior.pooler_porta }, tinhaSenhaReal: false }
    : lerPooler(textoConexao);
  if (!lido.pooler) return res.status(400).json({ message: lido.erro, campo: "conexao" });
  let url: string | null = null;
  if (a.tipo === "N2") {
    url = String(req.body?.url_pagina || "").trim() || null;
    if (url) {
      let u: URL;
      try { u = new URL(url); } catch { return res.status(400).json({ message: "Link da página inválido.", campo: "url_pagina" }); }
      if (u.protocol !== "https:") return res.status(400).json({ message: "O link da página precisa começar com https://", campo: "url_pagina" });
      if (url.length > 500) return res.status(400).json({ message: "Link muito longo.", campo: "url_pagina" });
    }
  }
  const p = lido.pooler;
  await exec(
    `INSERT INTO bd_entregas (avaliacao_id, user_id, matricula, nome, subject_id, tipo, projeto_ref, pooler_host, pooler_porta, url_pagina)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE subject_id=VALUES(subject_id), tipo=VALUES(tipo), projeto_ref=VALUES(projeto_ref),
       pooler_host=VALUES(pooler_host), pooler_porta=VALUES(pooler_porta), url_pagina=VALUES(url_pagina), nome=VALUES(nome)`,
    [a.av.id, s.uid, s.mat, s.nome, a.subject_id, a.tipo, p.ref, p.host, p.porta, url]);
  await logEvento("entrega_salva", `${a.av.id}:${p.ref}`, { userId: s.uid, ip: clientIp(req) });
  res.json({
    ok: true, conexao: stringVisivel(p),
    aviso: lido.tinhaSenhaReal ? "Você colou a senha do usuário postgres. Ela NÃO foi guardada, mas troque-a no Supabase (Project Settings → Database → Reset password) porque ela apareceu fora do painel." : null,
  });
});

r.post("/avaliacoes/:id/verificar", requireAluno, async (req, res) => {
  const s = (req as any).aluno as AlunoToken;
  const a = await avaliacaoDoAluno(s.uid, Number(req.params.id));
  if (!a) return res.status(404).json({ message: "Avaliação não encontrada." });
  if (!aberta(a.av)) return res.status(403).json({ message: "A avaliação não está aberta para verificações." });
  const e = (await q("SELECT * FROM bd_entregas WHERE avaliacao_id=? AND user_id=?", [a.av.id, s.uid]))[0];
  if (!e?.projeto_ref) return res.status(400).json({ message: "Salve a sua string de conexão antes de verificar." });
  const ultima = (await q("SELECT * FROM bd_correcoes WHERE entrega_id=? AND tipo='previa' ORDER BY id DESC LIMIT 1", [e.id]))[0];
  if (ultima && ["fila", "rodando"].includes(ultima.status)) return res.json({ id: ultima.id });
  if (ultima && Date.now() - new Date(ultima.criado_em).getTime() < INTERVALO_VERIFICACAO_MIN * 60_000) {
    return res.status(429).json({ message: `Aguarde ${INTERVALO_VERIFICACAO_MIN} minutos entre uma verificação e outra.` });
  }
  const hoje = Number((await q("SELECT COUNT(*) n FROM bd_correcoes WHERE entrega_id=? AND tipo='previa' AND criado_em >= CURDATE()", [e.id]))[0].n);
  if (hoje >= a.av.limite_dia) return res.status(429).json({ message: `Você já usou as ${a.av.limite_dia} verificações de hoje. Volte amanhã.` });
  const r2 = await exec("INSERT INTO bd_correcoes (entrega_id, tipo, solicitado_por) VALUES (?, 'previa', 'aluno')", [e.id]);
  res.json({ id: r2.insertId });
});

r.get("/correcoes/:id", requireAluno, async (req, res) => {
  const s = (req as any).aluno as AlunoToken;
  const c = (await q(
    `SELECT c.*, a.mostrar_nota FROM bd_correcoes c JOIN bd_entregas e ON e.id=c.entrega_id JOIN bd_avaliacoes a ON a.id=e.avaliacao_id
      WHERE c.id=? AND e.user_id=? AND c.tipo='previa'`, [Number(req.params.id), s.uid]))[0];
  if (!c) return res.status(404).json({ message: "Verificação não encontrada." });
  const naFrente = c.status === "fila" ? Number((await q("SELECT COUNT(*) n FROM bd_correcoes WHERE status IN ('fila','rodando') AND id < ?", [c.id]))[0].n) : 0;
  res.json({ ...resumo(c, !!c.mostrar_nota), na_frente: naFrente });
});

export default r;
