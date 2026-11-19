import { useCallback, useEffect, useRef, useState } from "react";
import { alunoApi as api, ApiError, fmtData, fmtNota, ITENS } from "../api";
import MatrixRain from "./MatrixRain";
import "@fontsource/vt323/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";

type Item = { item: string; ok: boolean; pontos?: number; obs: string };
type Correcao = {
  id: number; tipo: string; status: "fila" | "rodando" | "ok" | "erro"; criado_em: string; terminado_em: string | null;
  nota_banco?: number | null; nota_front?: number | null; alerta?: string | null; erro?: string | null;
  banco: Item[]; front: Item[]; na_frente?: number;
};
type Avaliacao = {
  id: number; titulo: string; tipo: "N1" | "N2"; abre_em: string; fecha_em: string; aberta: boolean; ainda_nao_abriu: boolean;
  mostrar_nota: boolean; notas_liberadas: boolean;
  entrega: { conexao: string | null; url_pagina: string | null; atualizado_em: string; ultimo_contato: string | null } | null;
  previa: Correcao | null; final: Correcao | null;
  verificacoes_hoje: number; limite_dia: number; proxima_verificacao: string | null;
};

export default function AlunoApp() {
  const [logado, setLogado] = useState(!!api.getToken());
  return (
    <div className="matrix">
      <MatrixRain intensidade={logado ? 0.16 : 0.4} />
      <header className="bg-slate-900 text-white" style={{ borderWidth: "0 0 1px" }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Logo />
          <div className="flex-1 min-w-0">
            <p className="mx-title text-2xl leading-none">LAB_BANCO_DE_DADOS</p>
            <p className="text-xs text-slate-400 mx-mono">avaliação CIPA · supabase · postgres</p>
          </div>
          {logado && <button className="text-sm text-slate-300 hover:text-white" onClick={() => { api.setToken(null); setLogado(false); }}>Sair</button>}
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">{logado ? <Painel onSair={() => setLogado(false)} /> : <Login onOk={() => setLogado(true)} />}</main>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="w-8 h-8 shrink-0" aria-hidden>
      <ellipse cx="16" cy="7" rx="11" ry="4" fill="#00b347" />
      <path d="M5 7v18c0 2.2 4.9 4 11 4s11-1.8 11-4V7c0 2.2-4.9 4-11 4S5 9.2 5 7z" fill="#00ff66" />
      <path d="M5 16c0 2.2 4.9 4 11 4s11-1.8 11-4" fill="none" stroke="#00b347" strokeWidth="1.5" />
    </svg>
  );
}

function Login({ onOk }: { onOk: () => void }) {
  const [matricula, setMatricula] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  async function entrar(e: React.FormEvent) {
    e.preventDefault(); setErro(""); setCarregando(true);
    try {
      const r = await api.post("/auth/login", { matricula, senha });
      api.setToken(r.token); onOk();
    } catch (err: any) { setErro(err.message); } finally { setCarregando(false); }
  }
  return (
    <form onSubmit={entrar} className="max-w-sm mx-auto mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div>
        <p className="mx-mono text-xs text-slate-500 tracking-widest">&gt; CONEXÃO SEGURA</p>
        <h1 className="mx-title text-4xl mt-1 mx-cursor">ACESSO</h1>
        <p className="text-sm text-slate-500 mt-1">Use a sua matrícula e a mesma senha do EduTest.</p>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Matrícula</span>
        <input value={matricula} onChange={e => setMatricula(e.target.value)} inputMode="numeric" autoComplete="username" required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Senha do EduTest</span>
        <input value={senha} onChange={e => setSenha(e.target.value)} type="password" autoComplete="current-password" required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </label>
      {erro && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-2">{erro}</p>}
      <button disabled={carregando} className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg py-2.5 disabled:opacity-60">
        {carregando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

function Painel({ onSair }: { onSair: () => void }) {
  const [dados, setDados] = useState<{ nome: string; matricula: string; avaliacoes: Avaliacao[] } | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    try { setDados(await api.get("/painel")); setErro(""); }
    catch (e: any) { if (e instanceof ApiError && e.status === 401) onSair(); else setErro(e.message); }
  }, [onSair]);
  useEffect(() => { carregar(); }, [carregar]);

  if (erro) return <p className="text-red-700">{erro}</p>;
  if (!dados) return <p className="text-slate-500">Carregando…</p>;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500 mx-mono">&gt; usuário autenticado</p>
        <h1 className="mx-title text-4xl">{dados.nome}</h1>
        <p className="text-sm text-slate-500 mx-mono">matrícula {dados.matricula}</p>
      </div>
      {dados.avaliacoes.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-slate-600">
          Nenhuma avaliação disponível para as suas turmas no momento.
        </div>
      )}
      {dados.avaliacoes.map(a => <CartaoAvaliacao key={a.id} a={a} matricula={dados.matricula} recarregar={carregar} />)}
    </div>
  );
}

function CartaoAvaliacao({ a, matricula, recarregar }: { a: Avaliacao; matricula: string; recarregar: () => void }) {
  const [verEnunciado, setVerEnunciado] = useState(false);
  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-5 border-b border-slate-100 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <span className="inline-block text-xs font-bold tracking-wide bg-teal-100 text-teal-800 rounded px-2 py-0.5">
            {a.tipo === "N2" ? "N2 · Banco + Front End" : "N1 · Banco de Dados"}
          </span>
          <h2 className="mx-title text-3xl mt-1">{a.titulo}</h2>
          <p className="text-sm text-slate-500">Prazo: <strong className="text-slate-700">{fmtData(a.fecha_em)}</strong></p>
        </div>
        <Situacao a={a} />
      </div>

      {a.ainda_nao_abriu ? (
        <p className="p-5 text-slate-600">A avaliação abre em {fmtData(a.abre_em)}.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          <Passo n={1} titulo="Leia o enunciado e baixe a sua carga">
            <p className="text-sm text-slate-600">A carga é um script SQL com dados <strong>só seus</strong>. Rode tudo no SQL Editor do seu projeto no Supabase.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-4 py-2"
                onClick={() => api.download(`/avaliacoes/${a.id}/carga`, `carga_${matricula}.sql`).catch(e => alert(e.message))}>
                Baixar carga_{matricula}.sql
              </button>
              <button className="rounded-lg border border-slate-300 hover:bg-slate-50 text-sm font-semibold px-4 py-2" onClick={() => setVerEnunciado(v => !v)}>
                {verEnunciado ? "Esconder enunciado" : "Ver enunciado"}
              </button>
            </div>
            {verEnunciado && <Enunciado id={a.id} />}
          </Passo>
          <Passo n={2} titulo="Informe a sua entrega">
            <FormEntrega a={a} recarregar={recarregar} />
          </Passo>
          <Passo n={3} titulo="Verifique a sua entrega">
            <Verificacao a={a} recarregar={recarregar} />
          </Passo>
        </div>
      )}
      {a.final && <NotaFinal a={a} />}
    </section>
  );
}

function Situacao({ a }: { a: Avaliacao }) {
  if (a.ainda_nao_abriu) return <span className="text-xs font-semibold rounded-full px-3 py-1 bg-slate-100 text-slate-600">Em breve</span>;
  if (a.aberta) return <span className="text-xs font-semibold rounded-full px-3 py-1 bg-emerald-100 text-emerald-800">Aberta</span>;
  return <span className="text-xs font-semibold rounded-full px-3 py-1 bg-slate-200 text-slate-700">Encerrada</span>;
}

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="p-5 flex gap-4">
      <div className="w-8 h-8 shrink-0 bg-slate-900 mx-title text-xl flex items-center justify-center">{n}</div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold mb-1 mx-mono text-slate-700">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function Enunciado({ id }: { id: number }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => { api.get(`/avaliacoes/${id}/enunciado`).then(r => setHtml(r.html)).catch(e => setHtml(`<p>${e.message}</p>`)); }, [id]);
  if (html === null) return <p className="text-sm text-slate-500 mt-3">Carregando enunciado…</p>;
  return <article className="enunciado mt-4 border border-slate-200 rounded-lg p-4 bg-slate-50/50" dangerouslySetInnerHTML={{ __html: html }} />;
}

function FormEntrega({ a, recarregar }: { a: Avaliacao; recarregar: () => void }) {
  const [conexao, setConexao] = useState("");
  const [url, setUrl] = useState(a.entrega?.url_pagina || "");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const temConexao = !!a.entrega?.conexao;

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setSalvando(true);
    try {
      const r = await api.put(`/avaliacoes/${a.id}/entrega`, { conexao: conexao || undefined, url_pagina: url });
      setConexao("");
      setMsg(r.aviso ? { tipo: "aviso", texto: r.aviso } : { tipo: "ok", texto: "Entrega salva." });
      recarregar();
    } catch (err: any) { setMsg({ tipo: "erro", texto: err.message }); } finally { setSalvando(false); }
  }

  if (!a.aberta) {
    return a.entrega
      ? <p className="text-sm text-slate-600">Conexão: <code className="text-xs bg-slate-100 rounded px-1 break-all">{a.entrega.conexao}</code>{a.entrega.url_pagina && <> · Página: <a className="text-teal-700 underline break-all" href={a.entrega.url_pagina} target="_blank" rel="noreferrer">{a.entrega.url_pagina}</a></>}</p>
      : <p className="text-sm text-slate-600">Você não enviou a entrega.</p>;
  }
  return (
    <form onSubmit={salvar} className="space-y-3">
      {temConexao && (
        <p className="text-sm text-slate-600">Conexão salva: <code className="text-xs bg-slate-100 rounded px-1 break-all">{a.entrega!.conexao}</code></p>
      )}
      <label className="block">
        <span className="text-sm font-medium">{temConexao ? "Trocar a string de conexão (opcional)" : "String de conexão do Session pooler"}</span>
        <input value={conexao} onChange={e => setConexao(e.target.value)} required={!temConexao} spellCheck={false}
          placeholder="postgresql://postgres.xxxxxxxxxxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-teal-500" />
        <span className="block text-xs text-slate-500 mt-1">
          No Supabase: <strong>Connect → Session pooler</strong> → copie a URI e cole aqui como está, com o <code>[YOUR-PASSWORD]</code>.
          A plataforma troca o usuário para <code>corretor</code> e coloca a senha dele sozinha. <strong>Não cole a senha do postgres.</strong>
        </span>
      </label>
      {a.tipo === "N2" && (
        <label className="block">
          <span className="text-sm font-medium">Link público da sua página</span>
          <input value={url} onChange={e => setUrl(e.target.value)} type="url" placeholder="https://seu-usuario.github.io/cipa/"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </label>
      )}
      {msg && <p className={`text-sm rounded-lg p-2 ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : msg.tipo === "aviso" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
      <button disabled={salvando} className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-4 py-2 disabled:opacity-60">
        {salvando ? "Salvando…" : "Salvar entrega"}
      </button>
    </form>
  );
}

function Verificacao({ a, recarregar }: { a: Avaliacao; recarregar: () => void }) {
  const [atual, setAtual] = useState<Correcao | null>(a.previa);
  const [erro, setErro] = useState("");
  const timer = useRef<number | null>(null);
  useEffect(() => { setAtual(a.previa); }, [a.previa?.id, a.previa?.status]);

  const acompanhar = useCallback((id: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    const passo = async () => {
      try {
        const c: Correcao = await api.get(`/correcoes/${id}`);
        setAtual(c);
        if (c.status === "fila" || c.status === "rodando") timer.current = window.setTimeout(passo, 3000);
        else recarregar();
      } catch (e: any) { setErro(e.message); }
    };
    passo();
  }, [recarregar]);

  useEffect(() => {
    if (a.previa && (a.previa.status === "fila" || a.previa.status === "rodando")) acompanhar(a.previa.id);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function verificar() {
    setErro("");
    try { const r = await api.post(`/avaliacoes/${a.id}/verificar`); acompanhar(r.id); }
    catch (e: any) { setErro(e.message); }
  }

  const ocupado = atual && (atual.status === "fila" || atual.status === "rodando");
  return (
    <div>
      <p className="text-sm text-slate-600">
        O corretor automático acessa o seu banco{a.tipo === "N2" ? " e abre a sua página" : ""} e mostra o que já está certo.
        {a.aberta && <> Você pode verificar quantas vezes quiser até o prazo ({a.verificacoes_hoje}/{a.limite_dia} hoje, uma a cada 3 minutos).</>}
        {" "}A nota que vale é a da <strong>correção final</strong>, feita depois do prazo.
      </p>
      {a.tipo === "N2" && <p className="text-xs text-slate-500 mt-1">Cada verificação da página cadastra um eleitor de teste (CPF começando com 999). Isso é esperado.</p>}
      {a.aberta && (
        <button onClick={verificar} disabled={!!ocupado || !a.entrega?.conexao}
          className="mt-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50">
          {ocupado ? "Verificando…" : "Verificar minha entrega"}
        </button>
      )}
      {!a.entrega?.conexao && a.aberta && <p className="text-xs text-slate-500 mt-1">Salve a entrega primeiro.</p>}
      {erro && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-2 mt-3">{erro}</p>}
      {atual && <ResultadoCorrecao c={atual} mostrarNota={a.mostrar_nota} tipo={a.tipo} />}
    </div>
  );
}

function ResultadoCorrecao({ c, mostrarNota, tipo }: { c: Correcao; mostrarNota: boolean; tipo: "N1" | "N2" }) {
  if (c.status === "fila" || c.status === "rodando") {
    return (
      <div className="mt-4 flex items-center gap-3 text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
        <span className="w-4 h-4 rounded-full border-2 border-teal-600 border-t-transparent animate-spin" />
        {c.status === "fila" ? `Na fila${c.na_frente ? ` (${c.na_frente} na sua frente)` : ""}…` : `Corrigindo${tipo === "N2" ? " (a página leva até 1 minuto)" : ""}…`}
      </div>
    );
  }
  return (
    <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
      <div className="bg-slate-50 px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-500">Verificado em {fmtData(c.terminado_em)}</span>
        {mostrarNota && c.nota_banco !== undefined && <span>Banco: <strong>{fmtNota(c.nota_banco)}</strong></span>}
        {mostrarNota && tipo === "N2" && c.nota_front !== undefined && <span>Front: <strong>{fmtNota(c.nota_front)}</strong></span>}
      </div>
      {c.erro && <p className="text-sm text-red-700 bg-red-50 px-4 py-2">{c.erro}</p>}
      {c.alerta && <p className="text-sm text-amber-900 bg-amber-50 px-4 py-2">Atenção: os dados do banco não são da carga da sua matrícula.</p>}
      <ListaItens itens={[...c.banco, ...c.front]} mostrarNota={mostrarNota} />
    </div>
  );
}

function ListaItens({ itens, mostrarNota }: { itens: Item[]; mostrarNota: boolean }) {
  if (!itens.length) return null;
  return (
    <ul className="divide-y divide-slate-100">
      {itens.map(i => (
        <li key={i.item} className="px-4 py-2 flex gap-3 text-sm">
          <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${i.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{i.ok ? "✓" : "✗"}</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium">{ITENS[i.item] || i.item}</p>
            {!i.ok && i.obs && <p className="text-slate-600 text-xs break-words">{i.obs}</p>}
          </div>
          {mostrarNota && i.pontos !== undefined && i.item !== "carga_do_aluno" && <span className="text-slate-500 tabular-nums">{fmtNota(i.pontos)}</span>}
        </li>
      ))}
    </ul>
  );
}

function NotaFinal({ a }: { a: Avaliacao }) {
  const c = a.final!;
  return (
    <div className="bg-slate-900 text-white p-5">
      <p className="text-sm text-slate-300">Nota final (corrigida em {fmtData(c.terminado_em)})</p>
      <div className="flex gap-8 mt-1">
        <div><p className="text-xs text-slate-400">Banco de Dados</p><p className="mx-title text-5xl tabular-nums">{fmtNota(c.nota_banco)}</p></div>
        {a.tipo === "N2" && <div><p className="text-xs text-slate-400">Front End</p><p className="mx-title text-5xl tabular-nums">{fmtNota(c.nota_front)}</p></div>}
      </div>
      {c.erro && <p className="text-sm text-red-300 mt-2">{c.erro}</p>}
      <details className="mt-3 bg-white text-slate-900 rounded-lg">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold">Ver correção item a item</summary>
        <ListaItens itens={[...c.banco, ...c.front]} mostrarNota />
      </details>
    </div>
  );
}
