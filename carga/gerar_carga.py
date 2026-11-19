#!/usr/bin/env python3
"""Gera o script de carga inicial (Postgres/Supabase) da avaliação CIPA para um aluno.

Uso:  python3 gerar_carga.py <matricula> [pasta_saida]
Os dados são determinísticos por matrícula: o mesmo aluno sempre recebe o mesmo script,
e alunos diferentes recebem dados diferentes (e portanto resultados esperados diferentes).
"""
import hashlib, random, sys, os, datetime

NOMES = ["Ana","Bruno","Carla","Diego","Eduarda","Felipe","Gabriela","Henrique","Isabela","João",
         "Karina","Lucas","Mariana","Nicolas","Olívia","Pedro","Quésia","Rafael","Sofia","Tiago",
         "Úrsula","Vinícius","Wesley","Yasmin","Zeca","Beatriz","Caio","Débora","Enzo","Fernanda"]
SOBRENOMES = ["Silva","Santos","Oliveira","Souza","Lima","Pereira","Costa","Rodrigues","Almeida",
              "Nascimento","Carvalho","Gomes","Martins","Araújo","Ribeiro","Barbosa","Rocha","Dias"]
SETORES = ["Administrativo","Produção","Logística","Manutenção","Qualidade","TI","Recursos Humanos"]
CHAPAS = [(10,"Segurança em Primeiro Lugar"),(20,"Trabalho Seguro"),(30,"Prevenção Já"),
          (40,"Unidos pela CIPA"),(50,"Saúde e Vida")]

def q(s): return "'" + str(s).replace("'", "''") + "'"

def gerar(matricula: str) -> str:
    seed = int(hashlib.sha256(matricula.strip().encode()).hexdigest(), 16) % (2**32)
    r = random.Random(seed)
    senha_corretor = "Cipa_" + hashlib.sha256(("corretor:" + matricula).encode()).hexdigest()[:12]

    setores = r.sample(SETORES, 5)
    chapas = r.sample(CHAPAS, 4)
    chapas.sort()
    n_eleitores = r.randint(180, 220)
    usados_cpf = set(); eleitores = []
    for i in range(1, n_eleitores + 1):
        while True:
            cpf = "".join(str(r.randint(0, 9)) for _ in range(11))
            if cpf not in usados_cpf: usados_cpf.add(cpf); break
        nome = f"{r.choice(NOMES)} {r.choice(SOBRENOMES)} {r.choice(SOBRENOMES)}"
        eleitores.append([i, nome, cpf, r.randint(18, 64), r.randint(1, len(setores)), False])

    # candidatos: 1 titular + 1 suplente por chapa
    candidatos = []; cid = 1
    for idx, _ in enumerate(chapas, start=1):
        for cargo in ("titular", "suplente"):
            e = r.choice(eleitores)
            candidatos.append((cid, e[0], idx, cargo)); cid += 1

    # pesos de votação diferentes por aluno; garante vencedor único
    pesos = [r.uniform(0.5, 3.0) for _ in chapas]
    votantes = r.sample(eleitores, int(n_eleitores * r.uniform(0.62, 0.82)))
    inicio = datetime.datetime(2026, 11, 25, 8, 0)
    votos = []; vid = 1
    for e in votantes:
        e[5] = True
        x = r.random()
        if x < 0.05:   tipo, chapa = "branco", None
        elif x < 0.09: tipo, chapa = "nulo", None
        else:          tipo, chapa = "valido", r.choices(range(1, len(chapas)+1), weights=pesos)[0]
        ts = inicio + datetime.timedelta(minutes=r.randint(0, 9*60))
        votos.append([vid, e[0], chapa, tipo, ts]); vid += 1
    # desempate: se houver empate no 1º lugar, soma um voto válido extra
    cont = {}
    for v in votos:
        if v[2]: cont[v[2]] = cont.get(v[2], 0) + 1
    top = sorted(cont.values(), reverse=True)
    lider = max(cont, key=cont.get)
    if len(top) > 1 and top[0] == top[1]:
        livre = next(e for e in eleitores if not e[5]); livre[5] = True
        votos.append([vid, livre[0], lider, "valido", inicio + datetime.timedelta(hours=9)]); vid += 1
    # irregularidades propositais: 3 eleitores votaram duas vezes (2º voto na chapa líder,
    # assim não há empate nem antes nem depois da limpeza dos duplicados)
    for e in r.sample([e for e in eleitores if e[5]], 3):
        votos.append([vid, e[0], lider, "valido", inicio + datetime.timedelta(minutes=r.randint(0, 540))]); vid += 1
    votos.sort(key=lambda v: v[4])
    for i, v in enumerate(votos, start=1): v[0] = i

    L = []
    L.append(f"-- Avaliação CIPA – carga inicial do aluno {matricula}")
    L.append("-- Cole TODO este script no SQL Editor do Supabase e clique em Run.\n")
    L.append("DROP VIEW IF EXISTS vw_eleitores_pendentes, vw_candidatos_por_chapa, vw_apuracao, vw_comparecimento_setor, vw_chapa_vencedora, vw_votos_por_hora, vw_votos_duplicados CASCADE;")
    L.append("DROP TABLE IF EXISTS voto, candidato, eleitor, chapa, setor CASCADE;\n")
    L.append("""CREATE TABLE setor (
  id_setor    SERIAL PRIMARY KEY,
  nome_setor  VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE eleitor (
  id_eleitor    SERIAL PRIMARY KEY,
  nome_eleitor  VARCHAR(100) NOT NULL,
  cpf           CHAR(11) NOT NULL UNIQUE,
  idade         INT NOT NULL CHECK (idade >= 18),
  id_setor      INT NOT NULL REFERENCES setor(id_setor),
  ja_votou      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE chapa (
  id_chapa      SERIAL PRIMARY KEY,
  numero_chapa  INT NOT NULL UNIQUE,
  nome_chapa    VARCHAR(80) NOT NULL
);

CREATE TABLE candidato (
  id_candidato  SERIAL PRIMARY KEY,
  id_eleitor    INT NOT NULL REFERENCES eleitor(id_eleitor),
  id_chapa      INT NOT NULL REFERENCES chapa(id_chapa),
  cargo         VARCHAR(10) NOT NULL CHECK (cargo IN ('titular','suplente'))
);

-- Atenção: de propósito, ainda NÃO há regra impedindo voto duplicado.
-- Faz parte da avaliação: limpar os duplicados e criar essa regra (Tarefa 7).
CREATE TABLE voto (
  id_voto     SERIAL PRIMARY KEY,
  id_eleitor  INT NOT NULL REFERENCES eleitor(id_eleitor),
  id_chapa    INT REFERENCES chapa(id_chapa),
  tipo_voto   VARCHAR(6) NOT NULL CHECK (tipo_voto IN ('valido','branco','nulo')),
  data_hora   TIMESTAMP NOT NULL,
  CHECK ((tipo_voto = 'valido') = (id_chapa IS NOT NULL))
);
""")
    L.append("INSERT INTO setor (id_setor, nome_setor) VALUES\n  " +
             ",\n  ".join(f"({i}, {q(s)})" for i, s in enumerate(setores, 1)) + ";")
    L.append("INSERT INTO chapa (id_chapa, numero_chapa, nome_chapa) VALUES\n  " +
             ",\n  ".join(f"({i}, {n}, {q(nm)})" for i, (n, nm) in enumerate(chapas, 1)) + ";")
    L.append("INSERT INTO eleitor (id_eleitor, nome_eleitor, cpf, idade, id_setor, ja_votou) VALUES\n  " +
             ",\n  ".join(f"({e[0]}, {q(e[1])}, {q(e[2])}, {e[3]}, {e[4]}, {'TRUE' if e[5] else 'FALSE'})" for e in eleitores) + ";")
    L.append("INSERT INTO candidato (id_candidato, id_eleitor, id_chapa, cargo) VALUES\n  " +
             ",\n  ".join(f"({c[0]}, {c[1]}, {c[2]}, {q(c[3])})" for c in candidatos) + ";")
    L.append("INSERT INTO voto (id_voto, id_eleitor, id_chapa, tipo_voto, data_hora) VALUES\n  " +
             ",\n  ".join(f"({v[0]}, {v[1]}, {v[2] if v[2] else 'NULL'}, {q(v[3])}, {q(v[4].strftime('%Y-%m-%d %H:%M:00'))})" for v in votos) + ";")
    L.append("""
-- Ajusta as sequências para os próximos INSERTs (ex.: cadastro pela página de Front)
SELECT setval('setor_id_setor_seq', (SELECT MAX(id_setor) FROM setor));
SELECT setval('chapa_id_chapa_seq', (SELECT MAX(id_chapa) FROM chapa));
SELECT setval('eleitor_id_eleitor_seq', (SELECT MAX(id_eleitor) FROM eleitor));
SELECT setval('candidato_id_candidato_seq', (SELECT MAX(id_candidato) FROM candidato));
SELECT setval('voto_id_voto_seq', (SELECT MAX(id_voto) FROM voto));
""")
    L.append(f"""-- Usuário SOMENTE LEITURA usado pela plataforma de correção.
-- Na plataforma, use este usuário na string de conexão, nunca a senha do usuário postgres.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corretor') THEN
    CREATE ROLE corretor LOGIN PASSWORD {q(senha_corretor)};
  ELSE
    ALTER ROLE corretor LOGIN PASSWORD {q(senha_corretor)};
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO corretor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO corretor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO corretor;

-- O corretor continua lendo os dados mesmo depois que você ligar o RLS (Parte B da N2).
-- NÃO apague estas políticas: sem elas o corretor enxerga as tabelas vazias.
CREATE POLICY corretor_leitura ON setor     FOR SELECT TO corretor USING (true);
CREATE POLICY corretor_leitura ON eleitor   FOR SELECT TO corretor USING (true);
CREATE POLICY corretor_leitura ON chapa     FOR SELECT TO corretor USING (true);
CREATE POLICY corretor_leitura ON candidato FOR SELECT TO corretor USING (true);
CREATE POLICY corretor_leitura ON voto      FOR SELECT TO corretor USING (true);
""")
    return "\n".join(L)

if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit(__doc__)
    mat = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else "."
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f"carga_{mat}.sql")
    open(path, "w", encoding="utf-8").write(gerar(mat))
    print(path)
