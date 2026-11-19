-- Banco da plataforma do Laboratório de Banco de Dados (separado do EduTest; o EduTest é só lido).
-- O servidor cria as tabelas sozinho na inicialização (backend/db.ts).

CREATE TABLE IF NOT EXISTS bd_avaliacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  turmas JSON NOT NULL,                     -- [{"subject_id": 9, "tipo": "N1"}, {"subject_id": 10, "tipo": "N2"}]
  abre_em DATETIME NOT NULL,
  fecha_em DATETIME NOT NULL,
  mostrar_nota TINYINT(1) NOT NULL DEFAULT 1,     -- aluno vê a nota na verificação prévia
  limite_dia INT NOT NULL DEFAULT 15,             -- verificações prévias por aluno por dia
  notas_liberadas TINYINT(1) NOT NULL DEFAULT 0,  -- aluno vê a nota final
  final_enfileirada_em DATETIME NULL,             -- correção final automática já disparada
  criado_por INT NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bd_entregas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  avaliacao_id INT NOT NULL,
  user_id INT NOT NULL,                     -- users.id do EduTest
  matricula VARCHAR(20) NOT NULL,
  nome VARCHAR(150) NOT NULL,
  subject_id INT NOT NULL,
  tipo ENUM('N1','N2') NOT NULL,
  projeto_ref VARCHAR(40) NULL,             -- ref do projeto Supabase
  pooler_host VARCHAR(120) NULL,
  pooler_porta INT NULL,
  url_pagina VARCHAR(500) NULL,
  ultimo_contato DATETIME NULL,             -- último acesso bem-sucedido ao banco (mantém o projeto acordado)
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entrega (avaliacao_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bd_correcoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entrega_id INT NOT NULL,
  tipo ENUM('previa','final','ping') NOT NULL,
  status ENUM('fila','rodando','ok','erro') NOT NULL DEFAULT 'fila',
  nota_banco DECIMAL(5,2) NULL,
  nota_front DECIMAL(5,2) NULL,
  alerta VARCHAR(255) NULL,
  erro VARCHAR(500) NULL,
  detalhes JSON NULL,
  solicitado_por VARCHAR(20) NOT NULL DEFAULT 'aluno',   -- aluno | professor | sistema
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em DATETIME NULL,
  terminado_em DATETIME NULL,
  KEY ix_fila (status, id),
  KEY ix_entrega (entrega_id, tipo, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bd_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(40) NOT NULL,
  detalhe VARCHAR(255) NULL,
  user_id INT NULL,
  ip VARCHAR(64) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_tipo (tipo, detalhe, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
