/**
 * Backend - Vipe Transportes
 * Express + Neon Postgres (serverless) + JWT Auth
 * Inclui: Embarques, Tarefas, Frota, CTEs e CRUDs auxiliares
 */

const express  = require('express');
const cors     = require('cors');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { neon } = require('@neondatabase/serverless');

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vipe_secret_2024';

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json());

// ─── NEON / POSTGRES ──────────────────────────────────────────────────────────
// sql é uma tagged template — ex: sql`SELECT * FROM x WHERE id = ${id}`
const sql = neon(process.env.DATABASE_URL);

// Helper: query com parâmetros posicionais ($1, $2…) para queries dinâmicas
async function query(text, params = []) {
  return sql.query(text, params);
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ message: 'Token não fornecido' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido ou expirado' });
  }
}

// ─── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── INICIALIZAR TABELAS ──────────────────────────────────────────────────────
async function initDB() {
  // Usuários
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         SERIAL PRIMARY KEY,
      nome       VARCHAR(100) NOT NULL,
      email      VARCHAR(150) NOT NULL UNIQUE,
      senha_hash VARCHAR(255) NOT NULL,
      cargo      VARCHAR(80)  DEFAULT 'Operador',
      ativo      BOOLEAN      DEFAULT TRUE,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    )
  `;

  // Tabelas de referência
  await sql`CREATE TABLE IF NOT EXISTS clientes (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(150) NOT NULL, cnpj VARCHAR(20), contato VARCHAR(100),
    email VARCHAR(150), created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS armadores (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(150) NOT NULL, codigo VARCHAR(20), created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS armazens (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(150) NOT NULL, municipio VARCHAR(100), uf VARCHAR(2),
    endereco VARCHAR(200), created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS destinos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pais VARCHAR(100) NOT NULL, porto VARCHAR(100), codigo VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS mercadorias (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    descricao VARCHAR(200) NOT NULL, ncm VARCHAR(20), unidade VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS motoristas (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(150) NOT NULL, cpf VARCHAR(20), cnh VARCHAR(30),
    telefone VARCHAR(20), created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS veiculos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    placa VARCHAR(10) NOT NULL, tipo VARCHAR(50), modelo VARCHAR(80),
    ano INT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS empresas (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razao_social VARCHAR(200) NOT NULL, cnpj VARCHAR(20),
    cidade VARCHAR(100), uf VARCHAR(2), created_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  // Embarques
  await sql`
    CREATE TABLE IF NOT EXISTS embarques (
      id            SERIAL PRIMARY KEY,
      booking       VARCHAR(50),
      contrato      VARCHAR(50),
      cliente_id    INT REFERENCES clientes(id)    ON DELETE SET NULL,
      armador_id    INT REFERENCES armadores(id)   ON DELETE SET NULL,
      armazem_id    INT REFERENCES armazens(id)    ON DELETE SET NULL,
      destino_id    INT REFERENCES destinos(id)    ON DELETE SET NULL,
      mercadoria_id INT REFERENCES mercadorias(id) ON DELETE SET NULL,
      municipio     VARCHAR(100),
      uf            VARCHAR(2),
      navio         VARCHAR(100),
      quant_cntr    INT,
      embalagem     VARCHAR(50),
      quant_total   NUMERIC(10,2),
      peso_liquido  NUMERIC(10,2),
      peso_bruto    NUMERIC(10,2),
      data_coleta   DATE,
      data_carreg   DATE,
      status        VARCHAR(50)  DEFAULT 'Pendente',
      fito          BOOLEAN      DEFAULT FALSE,
      fumigacao     BOOLEAN      DEFAULT FALSE,
      higienizacao  BOOLEAN      DEFAULT FALSE,
      forracao_dupla BOOLEAN     DEFAULT FALSE,
      created_at    TIMESTAMPTZ  DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `;

  // Embarque Status
  await sql`
    CREATE TABLE IF NOT EXISTS embarque_status (
      id          SERIAL PRIMARY KEY,
      embarque_id INT NOT NULL REFERENCES embarques(id) ON DELETE CASCADE,
      status      VARCHAR(50),
      data        TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Embarque Transporte
  await sql`
    CREATE TABLE IF NOT EXISTS embarque_transporte (
      id           SERIAL PRIMARY KEY,
      embarque_id  INT NOT NULL REFERENCES embarques(id)  ON DELETE CASCADE,
      motorista_id INT REFERENCES motoristas(id) ON DELETE SET NULL,
      veiculo_id   INT REFERENCES veiculos(id)   ON DELETE SET NULL,
      empresa_id   INT REFERENCES empresas(id)   ON DELETE SET NULL,
      data_saida   DATE,
      data_chegada DATE,
      status       VARCHAR(50) DEFAULT 'Pendente',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Tarefas
  await sql`
    CREATE TABLE IF NOT EXISTS tarefas (
      id              SERIAL PRIMARY KEY,
      titulo          VARCHAR(200) NOT NULL,
      descricao       TEXT,
      responsavel     VARCHAR(150),
      embarque_id     INT REFERENCES embarques(id) ON DELETE SET NULL,
      prioridade      VARCHAR(20)  DEFAULT 'media'   CHECK (prioridade IN ('baixa','media','alta','urgente')),
      status          VARCHAR(20)  DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida','cancelada')),
      data_vencimento DATE,
      created_by      INT REFERENCES usuarios(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // CTEs
  await sql`
    CREATE TABLE IF NOT EXISTS ctes (
      id           SERIAL PRIMARY KEY,
      numero_cte   VARCHAR(50) NOT NULL,
      embarque_id  INT REFERENCES embarques(id) ON DELETE SET NULL,
      empresa_id   INT REFERENCES empresas(id)  ON DELETE SET NULL,
      valor        NUMERIC(12,2),
      data_emissao DATE,
      status       VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','cancelado')),
      observacoes  TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Permissões
  await sql`
    CREATE TABLE IF NOT EXISTS usuario_permissoes (
      id         SERIAL PRIMARY KEY,
      usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      modulo     VARCHAR(50) NOT NULL,
      nivel      VARCHAR(10) DEFAULT 'none' CHECK (nivel IN ('none','read','write')),
      UNIQUE (usuario_id, modulo)
    )
  `;

  // Admin padrão
  const rows = await sql`SELECT id FROM usuarios WHERE email = 'admin@vipe.com.br'`;
  if (rows.length === 0) {
    const hash = await bcrypt.hash('vipe@2024', 10);
    await query(
      `INSERT INTO usuarios (nome, email, senha_hash, cargo) VALUES ($1, $2, $3, $4)`,
      ['Administrador', 'admin@vipe.com.br', hash, 'Administrador']
    );
    console.log('✅ Usuário padrão criado: admin@vipe.com.br / vipe@2024');
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

app.post('/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ message: 'E-mail e senha são obrigatórios' });
  try {
    const rows = await query(`SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE`, [email]);
    if (rows.length === 0) return res.status(401).json({ message: 'Credenciais inválidas' });
    const usuario = rows[0];
    const ok = await bcrypt.compare(senha, usuario.senha_hash);
    if (!ok) return res.status(401).json({ message: 'Credenciais inválidas' });
    const token = jwt.sign(
      { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

app.get('/auth/me', authMiddleware, (req, res) => res.json({ usuario: req.user }));

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────

app.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
      sql`SELECT COUNT(*) AS total FROM embarques`,
      sql`SELECT COUNT(*) AS pendentes FROM embarques WHERE status = 'Pendente'`,
      sql`SELECT COUNT(*) AS em_transporte FROM embarques WHERE status = 'Em Transporte'`,
      sql`SELECT COUNT(*) AS entregues FROM embarques WHERE status = 'Entregue'`,
      sql`SELECT COUNT(*) AS tarefas_pendentes FROM tarefas WHERE status = 'pendente'`,
      sql`SELECT COUNT(*) AS tarefas_urgentes FROM tarefas WHERE status != 'concluida' AND prioridade = 'urgente'`,
      sql`SELECT COUNT(*) AS ctes_pendentes FROM ctes WHERE status = 'pendente'`,
    ]);
    res.json({
      total:            Number(r1[0].total),
      pendentes:        Number(r2[0].pendentes),
      em_transporte:    Number(r3[0].em_transporte),
      entregues:        Number(r4[0].entregues),
      tarefas_pendentes:Number(r5[0].tarefas_pendentes),
      tarefas_urgentes: Number(r6[0].tarefas_urgentes),
      ctes_pendentes:   Number(r7[0].ctes_pendentes),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EMBARQUES ────────────────────────────────────────────────────────────────

app.get('/embarques', authMiddleware, async (req, res) => {
  try {
    const rows = await sql`
      SELECT e.id, e.booking, e.contrato, e.municipio, e.uf, e.navio,
        e.quant_cntr AS "quantCntr", e.embalagem,
        e.quant_total AS "quantTotal", e.peso_liquido AS "pesoLiquido",
        e.peso_bruto AS "pesoBruto", e.data_coleta AS "dataColeta",
        e.data_carreg AS "dataCarreg", e.status,
        e.fito, e.fumigacao, e.higienizacao, e.forracao_dupla AS "forracaoDupla",
        e.created_at AS "createdAt", e.updated_at AS "updatedAt",
        c.id AS cliente_id, c.nome AS cliente,
        a.id AS armador_id, a.nome AS armador,
        ar.id AS armazem_id, ar.nome AS armazem,
        d.id AS destino_id, d.porto AS destino,
        m.id AS mercadoria_id, m.descricao AS mercadoria
      FROM embarques e
      LEFT JOIN clientes    c  ON e.cliente_id    = c.id
      LEFT JOIN armadores   a  ON e.armador_id    = a.id
      LEFT JOIN armazens    ar ON e.armazem_id    = ar.id
      LEFT JOIN destinos    d  ON e.destino_id    = d.id
      LEFT JOIN mercadorias m  ON e.mercadoria_id = m.id
      ORDER BY e.id DESC
    `;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/buscar', authMiddleware, async (req, res) => {
  const { booking, contrato } = req.query;
  try {
    let text = `
      SELECT e.*, c.nome AS cliente, a.nome AS armador, ar.nome AS armazem,
        d.porto AS destino, m.descricao AS mercadoria
      FROM embarques e
      LEFT JOIN clientes    c  ON e.cliente_id    = c.id
      LEFT JOIN armadores   a  ON e.armador_id    = a.id
      LEFT JOIN armazens    ar ON e.armazem_id    = ar.id
      LEFT JOIN destinos    d  ON e.destino_id    = d.id
      LEFT JOIN mercadorias m  ON e.mercadoria_id = m.id
      WHERE 1=1
    `;
    const params = [];
    if (booking)  { params.push(booking);  text += ` AND e.booking = $${params.length}`; }
    if (contrato) { params.push(contrato); text += ` AND e.contrato = $${params.length}`; }
    const rows = await query(text, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Embarque não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/embarques', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const rows = await query(`
      INSERT INTO embarques (
        booking,contrato,cliente_id,armador_id,armazem_id,destino_id,mercadoria_id,
        municipio,uf,navio,quant_cntr,embalagem,quant_total,peso_liquido,peso_bruto,
        data_coleta,data_carreg,status,fito,fumigacao,higienizacao,forracao_dupla
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      ) RETURNING *
    `, [
      d.booking||null, d.contrato||null, d.cliente_id||null, d.armador_id||null,
      d.armazem_id||null, d.destino_id||null, d.mercadoria_id||null,
      d.municipio||null, d.uf||null, d.navio||null,
      d.quantCntr||null, d.embalagem||null, d.quantTotal||null,
      d.pesoLiquido||null, d.pesoBruto||null,
      d.dataColeta||null, d.dataCarreg||null, d.status||'Pendente',
      !!d.fito, !!d.fumigacao, !!d.higienizacao, !!d.forracaoDupla,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/embarques/:id', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const rows = await query(`
      UPDATE embarques SET
        booking=$1,contrato=$2,cliente_id=$3,armador_id=$4,armazem_id=$5,destino_id=$6,
        mercadoria_id=$7,municipio=$8,uf=$9,navio=$10,quant_cntr=$11,embalagem=$12,
        quant_total=$13,peso_liquido=$14,peso_bruto=$15,data_coleta=$16,data_carreg=$17,
        status=$18,fito=$19,fumigacao=$20,higienizacao=$21,forracao_dupla=$22,updated_at=NOW()
      WHERE id=$23 RETURNING *
    `, [
      d.booking||null, d.contrato||null, d.cliente_id||null, d.armador_id||null,
      d.armazem_id||null, d.destino_id||null, d.mercadoria_id||null,
      d.municipio||null, d.uf||null, d.navio||null,
      d.quantCntr||null, d.embalagem||null, d.quantTotal||null,
      d.pesoLiquido||null, d.pesoBruto||null,
      d.dataColeta||null, d.dataCarreg||null, d.status||'Pendente',
      !!d.fito, !!d.fumigacao, !!d.higienizacao, !!d.forracaoDupla,
      req.params.id,
    ]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/embarques/:id', authMiddleware, async (req, res) => {
  try {
    await query(`DELETE FROM embarques WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Embarque removido' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TAREFAS ──────────────────────────────────────────────────────────────────

const PRIORIDADE_ORDER = `CASE t.prioridade WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END`;

app.get('/tarefas', authMiddleware, async (req, res) => {
  try {
    const rows = await sql`
      SELECT t.*, e.booking AS embarque_booking, u.nome AS criado_por
      FROM tarefas t
      LEFT JOIN embarques e ON t.embarque_id = e.id
      LEFT JOIN usuarios  u ON t.created_by  = u.id
      ORDER BY
        CASE t.prioridade WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END,
        t.data_vencimento ASC NULLS LAST,
        t.id DESC
    `;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/tarefas', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const rows = await query(
      `INSERT INTO tarefas (titulo,descricao,responsavel,embarque_id,prioridade,status,data_vencimento,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [d.titulo, d.descricao||null, d.responsavel||null, d.embarque_id||null,
       d.prioridade||'media', d.status||'pendente', d.data_vencimento||null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/tarefas/:id', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const rows = await query(
      `UPDATE tarefas SET titulo=$1,descricao=$2,responsavel=$3,embarque_id=$4,
       prioridade=$5,status=$6,data_vencimento=$7,updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [d.titulo, d.descricao||null, d.responsavel||null, d.embarque_id||null,
       d.prioridade||'media', d.status||'pendente', d.data_vencimento||null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/tarefas/:id', authMiddleware, async (req, res) => {
  try {
    await query(`DELETE FROM tarefas WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Tarefa removida' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CTEs ─────────────────────────────────────────────────────────────────────

app.get('/ctes', authMiddleware, async (req, res) => {
  try {
    const rows = await sql`
      SELECT c.*, e.booking AS embarque_booking, em.razao_social AS empresa_nome
      FROM ctes c
      LEFT JOIN embarques e ON c.embarque_id = e.id
      LEFT JOIN empresas em ON c.empresa_id  = em.id
      ORDER BY c.id DESC
    `;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/ctes', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const rows = await query(
      `INSERT INTO ctes (numero_cte,embarque_id,empresa_id,valor,data_emissao,status,observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.numero_cte, d.embarque_id||null, d.empresa_id||null, d.valor||null,
       d.data_emissao||null, d.status||'pendente', d.observacoes||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/ctes/:id', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const rows = await query(
      `UPDATE ctes SET numero_cte=$1,embarque_id=$2,empresa_id=$3,valor=$4,
       data_emissao=$5,status=$6,observacoes=$7 WHERE id=$8 RETURNING *`,
      [d.numero_cte, d.embarque_id||null, d.empresa_id||null, d.valor||null,
       d.data_emissao||null, d.status||'pendente', d.observacoes||null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/ctes/:id', authMiddleware, async (req, res) => {
  try {
    await query(`DELETE FROM ctes WHERE id=$1`, [req.params.id]);
    res.json({ message: 'CTE removido' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STATUS / TRANSPORTES DE EMBARQUE ─────────────────────────────────────────

app.get('/embarques/:id/status', authMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM embarque_status WHERE embarque_id=$1 ORDER BY data DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/embarques/:id/status', authMiddleware, async (req, res) => {
  const { status } = req.body;
  try {
    await query(`INSERT INTO embarque_status (embarque_id,status) VALUES ($1,$2)`, [req.params.id, status]);
    await query(`UPDATE embarques SET status=$1, updated_at=NOW() WHERE id=$2`, [status, req.params.id]);
    res.status(201).json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/embarques/:id/transportes', authMiddleware, async (req, res) => {
  try {
    const rows = await query(`
      SELECT et.*, mo.nome AS motorista, ve.placa AS veiculo,
        ve.modelo AS veiculo_modelo, em.razao_social AS empresa
      FROM embarque_transporte et
      LEFT JOIN motoristas mo ON et.motorista_id = mo.id
      LEFT JOIN veiculos   ve ON et.veiculo_id   = ve.id
      LEFT JOIN empresas   em ON et.empresa_id   = em.id
      WHERE et.embarque_id=$1 ORDER BY et.id DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/embarques/:id/transportes', authMiddleware, async (req, res) => {
  const d = req.body;
  try {
    const rows = await query(
      `INSERT INTO embarque_transporte (embarque_id,motorista_id,veiculo_id,empresa_id,data_saida,data_chegada,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, d.motorista_id||null, d.veiculo_id||null, d.empresa_id||null,
       d.data_saida||null, d.data_chegada||null, d.status||'Pendente']
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CRUD GENÉRICO ────────────────────────────────────────────────────────────
const crudRoutes = [
  { path: '/motoristas',  table: 'motoristas'  },
  { path: '/veiculos',    table: 'veiculos'    },
  { path: '/empresas',    table: 'empresas'    },
  { path: '/clientes',    table: 'clientes'    },
  { path: '/armadores',   table: 'armadores'   },
  { path: '/mercadorias', table: 'mercadorias' },
  { path: '/armazens',    table: 'armazens'    },
  { path: '/destinos',    table: 'destinos'    },
];

crudRoutes.forEach(({ path: routePath, table }) => {
  app.get(routePath, authMiddleware, async (req, res) => {
    try {
      const rows = await query(`SELECT * FROM ${table} ORDER BY id DESC`);
      res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get(`${routePath}/:id`, authMiddleware, async (req, res) => {
    try {
      const rows = await query(`SELECT * FROM ${table} WHERE id=$1`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
      res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post(routePath, authMiddleware, async (req, res) => {
    try {
      const cols = Object.keys(req.body);
      const vals = Object.values(req.body);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      const rows = await query(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
      res.status(201).json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put(`${routePath}/:id`, authMiddleware, async (req, res) => {
    try {
      const cols = Object.keys(req.body);
      const vals = Object.values(req.body);
      const setCols = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
      const rows = await query(
        `UPDATE ${table} SET ${setCols} WHERE id=$${cols.length + 1} RETURNING *`,
        [...vals, req.params.id]
      );
      res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete(`${routePath}/:id`, authMiddleware, async (req, res) => {
    try {
      await query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]);
      res.json({ message: 'Removido' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

// ─── USUÁRIOS ─────────────────────────────────────────────────────────────────

app.get('/usuarios', authMiddleware, async (req, res) => {
  try {
    const rows = await sql`SELECT id,nome,email,cargo,ativo,created_at FROM usuarios ORDER BY id DESC`;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/usuarios', authMiddleware, async (req, res) => {
  const { nome, email, senha, cargo } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ message: 'nome, email e senha são obrigatórios' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    const rows = await query(
      `INSERT INTO usuarios (nome,email,senha_hash,cargo) VALUES ($1,$2,$3,$4) RETURNING id,nome,email,cargo`,
      [nome, email, hash, cargo||'Operador']
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/usuarios/:id/senha', authMiddleware, async (req, res) => {
  const { senha } = req.body;
  if (!senha) return res.status(400).json({ message: 'Nova senha obrigatória' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    await query(`UPDATE usuarios SET senha_hash=$1 WHERE id=$2`, [hash, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/usuarios/:id/dados', authMiddleware, async (req, res) => {
  const { nome, email, cargo } = req.body;
  if (!nome || !email) return res.status(400).json({ message: 'nome e email são obrigatórios' });
  try {
    const rows = await query(
      `UPDATE usuarios SET nome=$1,email=$2,cargo=$3 WHERE id=$4
       RETURNING id,nome,email,cargo,ativo`,
      [nome, email, cargo||'Operador', req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/usuarios/:id', authMiddleware, async (req, res) => {
  try {
    await query(`UPDATE usuarios SET ativo=FALSE WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Usuário desativado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PERMISSÕES ───────────────────────────────────────────────────────────────

app.get('/usuarios/:id/permissoes', authMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT modulo, nivel FROM usuario_permissoes WHERE usuario_id=$1`,
      [req.params.id]
    );
    const result = {};
    rows.forEach(r => { result[r.modulo] = r.nivel; });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/usuarios/:id/permissoes', authMiddleware, async (req, res) => {
  const permissoes = req.body;
  try {
    for (const [modulo, nivel] of Object.entries(permissoes)) {
      await query(
        `INSERT INTO usuario_permissoes (usuario_id,modulo,nivel) VALUES ($1,$2,$3)
         ON CONFLICT (usuario_id,modulo) DO UPDATE SET nivel=EXCLUDED.nivel`,
        [req.params.id, modulo, nivel]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── START ────────────────────────────────────────────────────────────────────
let dbReady = false;
initDB()
  .then(() => { dbReady = true; console.log('✅ Banco inicializado'); })
  .catch(err => console.error('❌ Erro ao inicializar DB:', err.message));

if (process.env.NODE_ENV !== 'production' || process.env.LOCAL_SERVER === 'true') {
  app.listen(PORT, () => console.log(`\n🚢  Vipe Transportes rodando em http://localhost:${PORT}\n`));
}

module.exports = app;
