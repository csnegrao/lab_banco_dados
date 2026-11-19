import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi as api, ApiError, fmtData, fmtNota, ITENS } from "../api";

type Turma = { id: number; name: string; alunos: number };
type Avaliacao = {
  id: number; titulo: string; turmas: { subject_id: number; tipo: "N1" | "N2" }[]; abre_em: string; fecha_em: string;
  limite_dia: number; mostrar_nota: boolean; notas_liberadas: boolean; final_enfileirada_em: string | null;
};
type Item = { item: string; ok: boolean; pontos: number; obs: string };
type Correcao = { id: number; tipo: string; status: string; terminado_em: string | null; nota_banco: any; nota_front: any; alerta: string | null; erro: string | null; banco: Item[]; front: Item[]; criado_em: string };
type Linha = {
  user_id: number; nome: string; matricula: string; turma: string; tipo: "N1" | "N2";
  entrega: { id: number; conexao: string | null; url_pagina: string | null; atualizado_em: string; ultimo_contato: string | null } | null;
  previa: Correcao | null; final: Correcao | null;
};

export default function AdminApp() {
  const [logado, setLogado] = useState(!!api.getToken());
  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/admin" className="font-semibold">Lab de Banco de Dados · Professor</a>
          <span className="flex-1" />
          {logado && <button className="text-sm text-slate-300 hover:text-white" onClick={() => { api.setToken(null); setLogado(false); }}>Sair</button>}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{logado ? <Inicio onSair={() => setLogado(false)} /> : <Login onOk={() => setLogado(true)} />}</main>
    </div>
  );
}

function Login({ onOk }: { onOk: () => void }) {
  const [identificador, setId] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  async function entrar(e: React.FormEvent) {
    e.preventDefault(); setErro("");
    try { const r = await api.post("/admin/login", { identificador, senha }); api.setToken(r.token); onOk(); }
    catch (err: any) { setErro(err.message); }
  }
  return (
    <form onSubmit={entrar} className="max-w-sm mx-auto mt-8 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <h1 className="text-xl font-bold">Entrar como professor</h1>
      <p className="text-sm text-slate-500">Conta de professor do EduTest.</p>
      <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="E-mail" value={identificador} onChange={e => setId(e.target.value)} required />
      <input className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} required />
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <button className="w-full bg-slate-900 text-white rounded-lg py-2.5 font-semibold">Entrar</button>
    </form>
  );
}

function Inicio({ onSair }: { onSair: () => void }) {
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[] | null>(null);
  const [turmas, setTurmas] = useState<Turma[]>([]);
  const [aberta, setAberta] = useState<number | null>(null);
  const [editando, setEditando] = useState<Avaliacao | "nova" | null>(null);
  const carregar = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([api.get("/admin/avaliacoes"), api.get("/admin/turmas")]);
      setAvaliacoes(a); setTurmas(t);
    } catch (e: any) { if (e instanceof ApiError && e.status === 401) onSair(); }
  }, [onSair]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!avaliacoes) return <p className="text-slate-500">Carregando…</p>;
  if (editando) return <FormAvaliacao inicial={editando === "nova" ? null : editando} turmas={turmas} onFim={() => { setEditando(null); carregar(); }} />;
  if (aberta) {
    const av = avaliacoes.find(a => a.id === aberta);
    if (av) return <PainelAvaliacao av={av} turmas={turmas} voltar={() => { setAberta(null); carregar(); }} editar={() => setEditando(av)} />;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <h1 className="text-2xl font-bold flex-1">Avaliações</h1>
        <button className="rounded-lg bg-teal-700 text-white font-semibold px-4 py-2 text-sm" onClick={() => setEditando("nova")}>Nova avaliação</button>
      </div>
      {avaliacoes.length === 0 && <p className="text-slate-600 bg-white border border-slate-200 rounded-xl p-6">Nenhuma avaliação criada ainda.</p>}
      {avaliacoes.map(a => (
        <button key={a.id} onClick={() => setAberta(a.id)} className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-teal-500">
          <p className="font-semibold">{a.titulo}</p>
          <p className="text-sm text-slate-500">
            {a.turmas.map(t => `${turmas.find(x => x.id === t.subject_id)?.name ?? "turma " + t.subject_id} (${t.tipo})`).join(" · ")}
          </p>
          <p className="text-sm text-slate-500">Abre {fmtData(a.abre_em)} · prazo {fmtData(a.fecha_em)}{a.notas_liberadas ? " · notas liberadas" : ""}</p>
        </button>
      ))}
    </div>
  );
}

const paraInput = (d: string | Date) => {
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function FormAvaliacao({ inicial, turmas, onFim }: { inicial: Avaliacao | null; turmas: Turma[]; onFim: () => void }) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "Avaliação CIPA · Banco de Dados e Front End");
  const [abre, setAbre] = useState(paraInput(inicial?.abre_em ?? new Date()));
  const [fecha, setFecha] = useState(paraInput(inicial?.fecha_em ?? new Date(Date.now() + 7 * 864e5)));
  const [sel, setSel] = useState<Record<number, "N1" | "N2" | "">>(() => Object.fromEntries((inicial?.turmas ?? []).map(t => [t.subject_id, t.tipo])));
  const [limite, setLimite] = useState(inicial?.limite_dia ?? 15);
  const [mostrar, setMostrar] = useState(inicial?.mostrar_nota ?? true);
  const [liberadas, setLiberadas] = useState(inicial?.notas_liberadas ?? false);
  const [erro, setErro] = useState("");

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro("");
    const corpo = {
      titulo, abre_em: new Date(abre).toISOString(), fecha_em: new Date(fecha).toISOString(), limite_dia: Number(limite),
      mostrar_nota: mostrar, notas_liberadas: liberadas,
      turmas: Object.entries(sel).filter(([, t]) => t).map(([id, tipo]) => ({ subject_id: Number(id), tipo })),
    };
    try {
      if (inicial) await api.put(`/admin/avaliacoes/${inicial.id}`, corpo); else await api.post("/admin/avaliacoes", corpo);
      onFim();
    } catch (err: any) { setErro(err.message); }
  }
  return (
    <form onSubmit={salvar} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold">{inicial ? "Editar avaliação" : "Nova avaliação"}</h1>
      <label className="block"><span className="text-sm font-medium">Título</span>
        <input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={titulo} onChange={e => setTitulo(e.target.value)} required /></label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block"><span className="text-sm font-medium">Abre em</span>
          <input type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={abre} onChange={e => setAbre(e.target.value)} required /></label>
        <label className="block"><span className="text-sm font-medium">Prazo (correção final automática)</span>
          <input type="datetime-local" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Turmas e tipo de avaliação</legend>
        <div className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {turmas.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">{t.name} <span className="text-slate-400">({t.alunos} alunos)</span></span>
              <select className="rounded border border-slate-300 px-2 py-1" value={sel[t.id] ?? ""} onChange={e => setSel(s => ({ ...s, [t.id]: e.target.value as any }))}>
                <option value="">não participa</option>
                <option value="N1">N1 · só banco</option>
                <option value="N2">N2 · banco + front</option>
              </select>
            </div>
          ))}
        </div>
      </fieldset>
      <label className="block"><span className="text-sm font-medium">Verificações por aluno por dia</span>
        <input type="number" min={0} max={100} className="mt-1 w-32 rounded-lg border border-slate-300 px-3 py-2" value={limite} onChange={e => setLimite(Number(e.target.value))} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mostrar} onChange={e => setMostrar(e.target.checked)} /> Aluno vê a nota parcial na verificação</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={liberadas} onChange={e => setLiberadas(e.target.checked)} /> Liberar a nota final para os alunos</label>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <div className="flex gap-2">
        <button className="rounded-lg bg-teal-700 text-white font-semibold px-4 py-2 text-sm">Salvar</button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={onFim}>Cancelar</button>
      </div>
    </form>
  );
}

function PainelAvaliacao({ av, turmas, voltar, editar }: { av: Avaliacao; turmas: Turma[]; voltar: () => void; editar: () => void }) {
  const [dados, setDados] = useState<{ alunos: Linha[]; fila: { fila?: number; rodando?: number } } | null>(null);
  const [filtro, setFiltro] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const carregar = useCallback(async () => { setDados(await api.get(`/admin/avaliacoes/${av.id}/painel`)); }, [av.id]);
  useEffect(() => { carregar(); const t = window.setInterval(carregar, 10000); return () => window.clearInterval(t); }, [carregar]);

  const linhas = useMemo(() => (dados?.alunos ?? []).filter(l =>
    !filtro || l.nome.toLowerCase().includes(filtro.toLowerCase()) || l.matricula.includes(filtro)), [dados, filtro]);
  const n = dados?.alunos.length ?? 0;
  const entregues = dados?.alunos.filter(l => l.entrega?.conexao).length ?? 0;
  const corrigidas = dados?.alunos.filter(l => l.final?.status === "ok").length ?? 0;
  const naFila = (dados?.fila.fila ?? 0) + (dados?.fila.rodando ?? 0);

  async function corrigirTodos() {
    if (!confirm("Corrigir agora (correção final) todas as entregas? Na N2, cada correção cadastra um eleitor de teste no banco do aluno.")) return;
    const r = await api.post(`/admin/avaliacoes/${av.id}/corrigir-todos`);
    setMsg(`${r.enfileiradas} correções na fila.`); carregar();
  }

  return (
    <div className="space-y-4">
      <button className="text-sm text-teal-700" onClick={voltar}>← Avaliações</button>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{av.titulo}</h1>
          <p className="text-sm text-slate-500">
            {av.turmas.map(t => `${turmas.find(x => x.id === t.subject_id)?.name ?? t.subject_id} (${t.tipo})`).join(" · ")} · prazo {fmtData(av.fecha_em)}
          </p>
        </div>
        <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={editar}>Editar</button>
        <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" onClick={() => api.download(`/admin/avaliacoes/${av.id}/csv`, `notas_avaliacao_${av.id}.csv`)}>Exportar CSV</button>
        <button className="rounded-lg bg-teal-700 text-white font-semibold px-3 py-2 text-sm" onClick={corrigirTodos}>Corrigir todos agora</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Numero rotulo="Alunos" valor={n} />
        <Numero rotulo="Entregaram" valor={entregues} />
        <Numero rotulo="Correção final" valor={corrigidas} />
        <Numero rotulo="Na fila agora" valor={naFila} />
      </div>
      <p className="text-xs text-slate-500">
        {av.final_enfileirada_em ? `Correção final automática disparada em ${fmtData(av.final_enfileirada_em)}.` : "A correção final roda sozinha no prazo."}
        {" "}{av.notas_liberadas ? "Notas finais liberadas para os alunos." : "Notas finais ainda não liberadas (Editar → liberar)."}
      </p>
      {msg && <p className="text-sm bg-emerald-50 text-emerald-800 rounded-lg p-2">{msg}</p>}
      <input className="w-full sm:w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Filtrar por nome ou matrícula" value={filtro} onChange={e => setFiltro(e.target.value)} />
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Aluno</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Entrega</th>
              <th className="px-3 py-2">Última verificação</th><th className="px-3 py-2">Final · banco</th><th className="px-3 py-2">Final · front</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {linhas.map(l => (
              <LinhaAluno key={l.user_id} l={l} aberto={aberto === l.user_id} alternar={() => setAberto(a => a === l.user_id ? null : l.user_id)} recarregar={carregar} />
            ))}
          </tbody>
        </table>
        {!dados && <p className="p-4 text-slate-500">Carregando…</p>}
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-3"><p className="text-xs text-slate-500">{rotulo}</p><p className="text-2xl font-bold tabular-nums">{valor}</p></div>;
}

function Status({ c }: { c: Correcao | null }) {
  if (!c) return <span className="text-slate-400">–</span>;
  if (c.status === "fila" || c.status === "rodando") return <span className="text-amber-700">{c.status === "fila" ? "na fila" : "corrigindo"}</span>;
  return null;
}

function LinhaAluno({ l, aberto, alternar, recarregar }: { l: Linha; aberto: boolean; alternar: () => void; recarregar: () => void }) {
  const [hist, setHist] = useState<Correcao[] | null>(null);
  useEffect(() => { if (aberto && l.entrega) api.get(`/admin/entregas/${l.entrega.id}/historico`).then(setHist); }, [aberto, l.entrega?.id, l.final?.id]);
  const f = l.final, p = l.previa;
  return (
    <>
      <tr className="align-top">
        <td className="px-3 py-2"><p className="font-medium">{l.nome}</p><p className="text-xs text-slate-500">{l.matricula} · {l.turma}</p></td>
        <td className="px-3 py-2">{l.tipo}</td>
        <td className="px-3 py-2">{l.entrega?.conexao ? <span className="text-emerald-700">✓ {fmtData(l.entrega.atualizado_em)}</span> : <span className="text-slate-400">não entregou</span>}</td>
        <td className="px-3 py-2">{p ? (p.status === "ok" ? <>{fmtNota(p.nota_banco)}{l.tipo === "N2" && <> / {fmtNota(p.nota_front)}</>} <span className="text-xs text-slate-400">{fmtData(p.terminado_em)}</span></> : <Status c={p} />) : <span className="text-slate-400">–</span>}</td>
        <td className="px-3 py-2 font-semibold tabular-nums">{f?.status === "ok" ? fmtNota(f.nota_banco) : <Status c={f} />}{f?.alerta && <p className="text-xs text-amber-700 font-normal">{f.alerta}</p>}{f?.erro && <p className="text-xs text-red-700 font-normal">{f.erro}</p>}</td>
        <td className="px-3 py-2 font-semibold tabular-nums">{l.tipo === "N2" ? (f?.status === "ok" ? fmtNota(f.nota_front) : <Status c={f} />) : <span className="text-slate-300">n/a</span>}</td>
        <td className="px-3 py-2 whitespace-nowrap">
          {l.entrega?.conexao && <button className="text-teal-700 text-xs mr-3" onClick={async () => { await api.post(`/admin/entregas/${l.entrega!.id}/corrigir`); recarregar(); }}>corrigir</button>}
          {l.entrega && <button className="text-slate-600 text-xs" onClick={alternar}>{aberto ? "fechar" : "detalhes"}</button>}
        </td>
      </tr>
      {aberto && l.entrega && (
        <tr><td colSpan={7} className="bg-slate-50 px-3 py-3">
          <p className="text-xs text-slate-600 break-all">Conexão: <code>{l.entrega.conexao}</code></p>
          {l.entrega.url_pagina && <p className="text-xs text-slate-600 break-all">Página: <a className="text-teal-700 underline" href={l.entrega.url_pagina} target="_blank" rel="noreferrer">{l.entrega.url_pagina}</a></p>}
          <p className="text-xs text-slate-500">Último contato com o banco: {fmtData(l.entrega.ultimo_contato)}</p>
          {!hist && <p className="text-xs text-slate-500 mt-2">Carregando histórico…</p>}
          {hist?.map(c => (
            <details key={c.id} className="mt-2 bg-white border border-slate-200 rounded-lg" open={c.id === hist[0]?.id}>
              <summary className="cursor-pointer px-3 py-1.5 text-xs">
                {c.tipo === "final" ? "Final" : "Prévia"} · {c.status} · {fmtData(c.terminado_em || c.criado_em)} · banco {fmtNota(c.nota_banco)}{l.tipo === "N2" && ` · front ${fmtNota(c.nota_front)}`}
              </summary>
              {c.erro && <p className="text-xs text-red-700 px-3">{c.erro}</p>}
              <ul className="text-xs px-3 pb-2">
                {[...c.banco, ...c.front].map(i => (
                  <li key={i.item} className="flex gap-2 py-0.5"><span className={i.ok ? "text-emerald-700" : "text-red-700"}>{i.ok ? "✓" : "✗"}</span>
                    <span className="flex-1">{ITENS[i.item] || i.item}{!i.ok && <span className="text-slate-500"> — {i.obs}</span>}</span>
                    <span className="tabular-nums">{i.item === "carga_do_aluno" ? "" : fmtNota(i.pontos)}</span></li>
                ))}
              </ul>
            </details>
          ))}
        </td></tr>
      )}
    </>
  );
}
