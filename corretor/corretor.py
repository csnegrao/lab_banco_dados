#!/usr/bin/env python3
"""Corretor em lote da avaliação CIPA (Banco N1/N2 + Front N2).

Uso:
  python3 corretor.py entregas.csv [saida_dir]

entregas.csv (exportado do Google Forms) precisa das colunas:
  matricula, nome, turma (N1 ou N2), string_conexao, url_pagina (só N2)

A string de conexão deve usar o usuário só-leitura `corretor` criado pelo script de carga.
Gera saida_dir/notas.csv (uma linha por aluno) e saida_dir/detalhes.json (feedback item a item).
"""
import csv, json, os, re, subprocess, sys, random, string, time
from decimal import Decimal
import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "carga"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gerar_carga import gerar  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))

# ---------- gabarito ----------
# As consultas de referência ficam em corretor/gabarito_ref.py, que NÃO vai para o repositório
# (está no .gitignore). Copie o arquivo para o servidor separadamente.
try:
    from gabarito_ref import REF
except ImportError:
    sys.exit("Falta corretor/gabarito_ref.py (gabarito). Copie-o para a pasta corretor/ antes de rodar.")
PESO_VIEW = 1.25          # 6 views x 1,25 = 7,5
TABELAS = ["setor", "eleitor", "chapa", "candidato", "voto"]


def norm(v):
    if v is None: return None
    if isinstance(v, bool): return v
    if isinstance(v, (int, float, Decimal)): return f"{float(v):.2f}"
    return str(v).strip()


def multiset(rows):
    return sorted((tuple(norm(x) for x in r) for r in rows), key=repr)


def corrigir_banco(conn_str, matricula):
    itens, nota = [], 0.0
    sql_carga = gerar(matricula)
    m = re.search(r"INSERT INTO eleitor .*?;", sql_carga, re.S)
    cpfs_esperados = set(re.findall(r"'(\d{11})'", m.group(0)))
    m = re.search(r"INSERT INTO voto .*?;", sql_carga, re.S)
    eleitores_votos = re.findall(r"^\s*\((\d+), (\d+),", m.group(0), re.M)
    votos_originais = len(eleitores_votos)
    eleitores_votos = [e for _, e in eleitores_votos]
    n_dup = len(eleitores_votos) - len(set(eleitores_votos))

    with psycopg.connect(conn_str, connect_timeout=15, autocommit=True) as cx:
        cx.execute("SET default_transaction_read_only = on")
        cx.execute("SET statement_timeout = '15s'")
        cur = cx.cursor()

        # carga do próprio aluno?
        cur.execute("SELECT cpf FROM eleitor")
        cpfs = {r[0] for r in cur.fetchall()}
        faltando = len(cpfs_esperados - cpfs)
        itens.append({"item": "carga_do_aluno", "ok": faltando == 0, "pontos": 0,
                      "obs": "dados conferem com a matrícula" if faltando == 0 else
                             f"ATENÇÃO: {faltando} eleitores da carga desta matrícula não estão no banco (carga de outra pessoa?)"})

        for view, (cols, ref_sql) in REF.items():
            it = {"item": view, "ok": False, "pontos": 0.0, "obs": ""}
            cur.execute("SELECT definition FROM pg_views WHERE schemaname='public' AND viewname=%s", (view,))
            r = cur.fetchone()
            if not r:
                it["obs"] = "view não encontrada"; itens.append(it); continue
            definicao = r[0].lower()
            if not re.search(r"\b(" + "|".join(TABELAS) + r"|vw_\w+)\b", definicao):
                it["obs"] = "view não consulta as tabelas (valores fixos?)"; itens.append(it); continue
            cur.execute(f'SELECT * FROM "{view}"')
            cols_aluno = [d.name for d in cur.description]
            linhas_aluno = cur.fetchall()
            if sorted(cols_aluno) != sorted(cols):
                it["pontos"] = round(PESO_VIEW * 0.2, 2)
                it["obs"] = f"colunas esperadas {cols}, encontradas {cols_aluno}"
                nota += it["pontos"]; itens.append(it); continue
            idx = [cols_aluno.index(c) for c in cols]
            linhas_aluno = [[l[i] for i in idx] for l in linhas_aluno]
            cur.execute(ref_sql)
            esperado = cur.fetchall()
            if multiset(linhas_aluno) == multiset(esperado):
                it.update(ok=True, pontos=PESO_VIEW, obs="ok")
            else:
                it["pontos"] = round(PESO_VIEW * 0.4, 2)
                it["obs"] = f"estrutura ok, dados diferentes ({len(linhas_aluno)} linhas; esperado {len(esperado)})"
            nota += it["pontos"]; itens.append(it)

        # Tarefa 7 – voto único por eleitor
        cur.execute("SELECT COUNT(*) FROM (SELECT id_eleitor FROM voto GROUP BY id_eleitor HAVING COUNT(*)>1) d")
        dups = cur.fetchone()[0]
        itens.append({"item": "t7_sem_duplicados", "ok": dups == 0, "pontos": 1.0 if dups == 0 else 0,
                      "obs": "ok" if dups == 0 else f"{dups} eleitor(es) ainda com voto repetido"})
        cur.execute("""
          SELECT COUNT(*) FROM pg_index i
          JOIN pg_class t ON t.oid=i.indrelid AND t.relname='voto'
          JOIN pg_namespace n ON n.oid=t.relnamespace AND n.nspname='public'
          JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname='id_eleitor'
          WHERE i.indisunique AND i.indnatts=1 AND i.indkey[0]=a.attnum""")
        tem_uq = cur.fetchone()[0] > 0
        itens.append({"item": "t7_regra_unique", "ok": tem_uq, "pontos": 1.0 if tem_uq else 0,
                      "obs": "ok" if tem_uq else "não há UNIQUE em voto(id_eleitor)"})
        cur.execute("SELECT COUNT(*) FROM voto WHERE id_voto <= %s", (votos_originais,))
        restantes = cur.fetchone()[0]
        ok = restantes == votos_originais - n_dup
        itens.append({"item": "t7_sem_perda_de_votos", "ok": ok, "pontos": 0.5 if ok else 0,
                      "obs": "ok" if ok else f"esperado {votos_originais - n_dup} votos originais, há {restantes}"})
        nota += sum(i["pontos"] for i in itens if i["item"].startswith("t7_"))

    return round(nota, 2), itens


def dados_front(conn_str):
    with psycopg.connect(conn_str, connect_timeout=15, autocommit=True) as cx:
        cur = cx.cursor()
        cur.execute("""SELECT c.numero_chapa, COUNT(v.id_voto) FROM chapa c
                       LEFT JOIN voto v ON v.id_chapa=c.id_chapa AND v.tipo_voto='valido' GROUP BY 1""")
        apur = {str(n): int(t) for n, t in cur.fetchall()}
        cur.execute("SELECT e.nome_eleitor FROM candidato ca JOIN eleitor e ON e.id_eleitor=ca.id_eleitor")
        cands = sorted(r[0].strip() for r in cur.fetchall())
        cur.execute("SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                    "WHERE n.nspname='public' AND relname = ANY(%s)", (TABELAS,))
        rls = dict(cur.fetchall())
        cur.execute("SELECT MIN(id_setor) FROM setor")
        setor = cur.fetchone()[0]
    return apur, cands, rls, setor


def corrigir_front(url, conn_str):
    itens = []
    apur, cands, rls, setor = dados_front(conn_str)
    cpf_teste = "999" + "".join(random.choices(string.digits, k=8))
    nome_teste = "Teste Corretor " + "".join(random.choices(string.ascii_uppercase, k=5))
    p = subprocess.run(["node", os.path.join(AQUI, "corretor_front.js"), url, nome_teste, cpf_teste, str(setor)],
                       capture_output=True, text=True, timeout=120)
    try:
        r = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        r = {"carregou": False, "erro": (p.stderr or p.stdout)[-300:]}

    itens.append({"item": "front_pagina_abre", "ok": r.get("carregou", False), "pontos": 1.0 if r.get("carregou") else 0,
                  "obs": r.get("erro") or "ok"})
    pag_apur = {str(x["numero"]).strip(): str(x["total"]).strip() for x in r.get("apuracao", [])}
    ok = bool(pag_apur) and pag_apur == {k: str(v) for k, v in apur.items()}
    itens.append({"item": "front_apuracao", "ok": ok, "pontos": 3.0 if ok else (1.0 if pag_apur else 0),
                  "obs": "ok" if ok else f"página mostrou {pag_apur}, banco tem {apur}"})
    pag_cands = sorted(c.strip() for c in r.get("candidatos", []))
    ok = pag_cands == cands
    itens.append({"item": "front_candidatos", "ok": ok, "pontos": 2.0 if ok else (0.5 if pag_cands else 0),
                  "obs": "ok" if ok else f"{len(pag_cands)} candidatos na página, {len(cands)} no banco"})
    time.sleep(2)
    with psycopg.connect(conn_str, connect_timeout=15) as cx:
        gravou = cx.execute("SELECT COUNT(*) FROM eleitor WHERE cpf=%s", (cpf_teste,)).fetchone()[0] > 0
    itens.append({"item": "front_cadastro", "ok": gravou, "pontos": 3.0 if gravou else (0.5 if r.get("enviou") else 0),
                  "obs": "ok" if gravou else ("formulário enviado, mas o eleitor não foi gravado" if r.get("enviou")
                                              else "formulário do contrato não encontrado")})
    ok = all(rls.get(t) for t in TABELAS)
    itens.append({"item": "front_rls", "ok": ok, "pontos": 1.0 if ok else 0,
                  "obs": "ok" if ok else "RLS desligado em: " + ", ".join(t for t in TABELAS if not rls.get(t))})
    return round(sum(i["pontos"] for i in itens), 2), itens


def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    saida = sys.argv[2] if len(sys.argv) > 2 else "resultado"
    os.makedirs(saida, exist_ok=True)
    linhas = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
    notas, detalhes = [], {}
    for l in linhas:
        k = {c.lower().strip(): (v or "").strip() for c, v in l.items()}
        mat, turma = k.get("matricula", ""), k.get("turma", "").upper()
        conn, url = k.get("string_conexao", ""), k.get("url_pagina", "")
        print(f"→ {mat} {k.get('nome','')} ({turma})", flush=True)
        reg = {"matricula": mat, "nome": k.get("nome", ""), "turma": turma, "nota_banco": "", "nota_front": "", "alerta": "", "erro": ""}
        det = {}
        try:
            reg["nota_banco"], det["banco"] = corrigir_banco(conn, mat)
            if not det["banco"][0]["ok"]:
                reg["alerta"] = "carga não é desta matrícula: revisar"
            if turma == "N2" and url:
                reg["nota_front"], det["front"] = corrigir_front(url, conn)
            elif turma == "N2":
                reg["nota_front"] = 0; reg["erro"] = "sem link da página"
        except Exception as e:
            msg = str(e)
            if "password authentication failed" in msg: msg = "não conectou: senha do usuário corretor incorreta"
            elif "connection" in msg.lower() and "failed" in msg.lower(): msg = "não conectou: confira a string de conexão (host/porta)"
            reg["erro"] = f"{type(e).__name__}: {msg[:200]}"
        notas.append(reg); detalhes[mat] = det
    with open(os.path.join(saida, "notas.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(notas[0].keys())); w.writeheader(); w.writerows(notas)
    json.dump(detalhes, open(os.path.join(saida, "detalhes.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"ok: {len(notas)} entregas corrigidas → {saida}/notas.csv")


if __name__ == "__main__":
    main()
