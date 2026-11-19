# Laboratório de Banco de Dados e Front End: Avaliação CIPA

Avaliação prática das turmas de ADS:

- **N1 (Modelagem de Banco de Dados):** o aluno carrega o banco da eleição da CIPA no Supabase (Postgres), cria 6 views e uma regra de integridade.
- **N2 (Banco + Front End):** faz a mesma parte de banco e também uma página HTML/CSS/JS que lê os dados e cadastra eleitores.

A correção é **em lote**: depois do prazo, o professor roda o corretor no servidor com a lista de entregas e recebe as notas em CSV.

## Plataforma web (labbd.sl20.com.br)

Além da correção em lote, o repositório tem uma plataforma web (Express + React, na raiz):

- **Aluno** entra com a matrícula e a senha do EduTest, lê o enunciado, baixa a sua carga, cola a string do *Session pooler* do Supabase (a plataforma troca o usuário por `corretor` e usa a senha da matrícula; nenhuma senha do aluno é guardada), informa o link da página (N2) e clica em **Verificar minha entrega** para ver o que já está certo.
- **Professor** (`/admin`, conta de professor do EduTest) cria a avaliação (turmas N1/N2, abertura e prazo), acompanha as entregas, dispara a correção final, libera as notas e exporta o CSV.
- No **prazo**, a correção final de todas as entregas roda sozinha. Uma vez por dia a plataforma faz um `SELECT 1` em cada banco para o projeto gratuito do Supabase não pausar.
- O corretor roda como usuário sem privilégios e só acessa o pooler do Supabase e páginas https com IP público.

Implantação: `docs/IMPLANTACAO.md`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `carga/gerar_carga.py` | Gera o script SQL de carga **personalizado por matrícula**. Cada aluno recebe dados diferentes. |
| `enunciado/` | Enunciados para os alunos (`N1.md`, `N2.md`). |
| `corretor/` | Corretor em lote: `corretor.py` (banco) e `corretor_front.js` (página, com navegador automático). |
| `exemplos/` | Modelo da planilha de entregas. |

> **O gabarito não fica no repositório**, porque o repositório é público. O arquivo `corretor/gabarito_ref.py` está no `.gitignore`. Copie-o para o servidor por fora (scp/sftp).

## 1. Gerar a carga de cada aluno

```bash
mkdir -p cargas
while read mat; do python3 carga/gerar_carga.py "$mat" cargas; done < matriculas.txt
```

Entregue a cada aluno o seu `cargas/carga_<matricula>.sql`. O script cria as tabelas, insere os dados e cria o usuário **somente leitura** `corretor`, com uma senha própria da matrícula que aparece no fim do script.

## 2. Instalar o corretor no servidor

Requisitos: Python 3.10+, Node 18+ e acesso de saída às portas 5432/6543 do Supabase.

```bash
git clone https://github.com/csnegrao/lab_banco_dados.git && cd lab_banco_dados
python3 -m venv .venv && . .venv/bin/activate
pip install -r corretor/requirements.txt
cd corretor && npm install && npx playwright install --with-deps chromium && cd ..
# copiar o gabarito (fora do git):
scp gabarito_ref.py servidor:lab_banco_dados/corretor/
```

## 3. Corrigir

1. Exporte as respostas do formulário para CSV com as colunas `matricula, nome, turma, string_conexao, url_pagina` (veja `exemplos/entregas_exemplo.csv`).
2. Rode:

```bash
python3 corretor/corretor.py entregas.csv resultado
```

Saída:
- `resultado/notas.csv`: uma linha por aluno, com `nota_banco`, `nota_front` (só N2), `alerta` e `erro`.
- `resultado/detalhes.json`: feedback item a item, para devolver ao aluno.

### O que é avaliado

**Banco (N1 e N2), nota 10**

| Item | Pontos | Como o corretor confere |
|---|---|---|
| 6 views | 1,25 cada | Primeiro confere se a view existe e se consulta as tabelas. Se as colunas estiverem certas, ganha 40% do valor; se os dados também baterem com o gabarito rodado sobre os dados atuais do aluno, ganha 100%. |
| T7: sem votos duplicados | 1,0 | Nenhum eleitor com mais de um voto. |
| T7: regra `UNIQUE (id_eleitor)` em `voto` | 1,0 | Procura um índice ou constraint única só nessa coluna. |
| T7: nenhum voto legítimo apagado | 0,5 | Os votos originais que restaram devem ser exatamente o total original menos os duplicados. |

O corretor também confere se os CPFs da carga daquela matrícula estão no banco. Se não estiverem, preenche a coluna `alerta` ("carga não é desta matrícula"), o que indica banco copiado de outra pessoa.

**Front (só N2), nota 10**

| Item | Pontos |
|---|---|
| Página abre (HTTP 200, sem erro de JS) | 1,0 |
| Apuração na página igual à do banco | 3,0 |
| Candidatos listados iguais aos do banco | 2,0 |
| Cadastro de eleitor pelo formulário gravado no banco | 3,0 |
| RLS ativado nas 5 tabelas | 1,0 |

> Atenção à ordem: o corretor faz primeiro a parte de banco e depois a de Front, porque o teste de Front cadastra um eleitor de teste (CPF começando com `999`).
