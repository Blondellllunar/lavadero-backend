const express = require("express");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const QRCode = require("qrcode");

const app = express();

/* ==========================
   MIDDLEWARES
========================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ==========================
   SQLITE DB (ARCHIVO REAL)
========================== */
const db = new sqlite3.Database("./database.sqlite", (err) => {
  if (err) {
    console.error("❌ Error SQLite:", err.message);
  } else {
    console.log("✅ SQLite conectado");
  }
});

/* ==========================
   CREAR TABLAS (UNA SOLA VEZ)
========================== */
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE,
      password TEXT,
      rol TEXT,
      activo INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lavadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT,
      turno TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aseo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      turno TEXT,
      lavador_id INTEGER,
      tareas TEXT,
      observacion TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS entregas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      turno TEXT,
      lavador_id INTEGER,
      producto TEXT,
      cantidad INTEGER,
      observacion TEXT,
      registrado_por INTEGER
    )
  `);

  console.log("✅ Tablas SQLite listas");
});

/* ==========================
   SERVIDOR OK
========================== */
app.get("/", (req, res) => {
  res.send("Servidor funcionando ✅");
});

/* ==========================
   LOGIN (FUNCIONA)
========================== */
app.post("/login", (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const sql = `
    SELECT id, usuario, rol
    FROM usuarios
    WHERE usuario = ? AND password = ? AND activo = 1
    LIMIT 1
  `;

  db.get(sql, [usuario, password], (err, row) => {
    if (err) {
      console.error("❌ Error login:", err.message);
      return res.status(500).json({ message: "Error servidor" });
    }

    if (!row) {
      return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }

    res.json(row);
  });
});
// ==========================
// CREAR USUARIO (TEMPORAL)
// ==========================
app.post("/crear-usuario", (req, res) => {
  const { usuario, password, rol } = req.body;

  if (!usuario || !password || !rol) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  if (!["admin", "dia", "noche"].includes(rol)) {
    return res.status(400).json({ message: "Rol inválido" });
  }

  const sql = `
    INSERT INTO usuarios (usuario, password, rol, activo)
    VALUES (?, ?, ?, 1)
  `;

  db.run(sql, [usuario, password, rol], function (err) {
    if (err) {
      return res.status(500).json({ message: "Usuario ya existe" });
    }

    res.json({ message: "Usuario creado correctamente" });
  });
});

/* ==========================
   CREAR ADMIN (USAR 1 VEZ)
========================== */
app.get("/crear-admin", (req, res) => {
  db.run(
    `INSERT OR IGNORE INTO usuarios (usuario, password, rol, activo)
     VALUES ('admin', '1234', 'admin', 1)`,
    (err) => {
      if (err) {
        return res.json({ error: err.message });
      }

      res.json({
        message: "Admin creado",
        usuario: "admin",
        password: "1234"
      });
    }
  );
});

/* ==========================
   LAVADORES
========================== */
app.get("/lavadores", (req, res) => {
  const turno = req.query.turno;

  let sql = "SELECT * FROM lavadores";
  const params = [];

  if (turno && turno !== "admin") {
    sql += " WHERE turno = ?";
    params.push(turno);
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ message: "Error lavadores" });
    }
    res.json(rows);
  });
});

app.post("/lavadores", (req, res) => {
  const { nombre, turno } = req.body;

  if (!nombre || !turno) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  db.run(
    "INSERT INTO lavadores (nombre, turno) VALUES (?, ?)",
    [nombre, turno],
    function (err) {
      if (err) {
        return res.status(500).json({ message: "Error creando lavador" });
      }
      res.json({ id: this.lastID, nombre, turno });
    }
  );
});

/* ==========================
   QR LAVADOR
========================== */
app.get("/lavadores/:id/qr", async (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM lavadores WHERE id = ?", [id], async (err, row) => {
    if (!row) {
      return res.status(404).json({ message: "Lavador no encontrado" });
    }

    const url = `${req.protocol}://${req.get("host")}/aseo-qr.html?lavador=${id}`;
    const qr = await QRCode.toDataURL(url);

    res.json({ qr, url });
  });
});

/* ==========================
   REGISTRAR ASEO
========================== */
app.post("/aseo", (req, res) => {
  const { turno, lavador_id, tareas, observacion } = req.body;

  if (!turno || !lavador_id || !Array.isArray(tareas) || tareas.length === 0) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const fecha = new Date().toISOString().split("T")[0];

  db.run(
    `INSERT INTO aseo (fecha, turno, lavador_id, tareas, observacion)
     VALUES (?, ?, ?, ?, ?)`,
    [fecha, turno, lavador_id, JSON.stringify(tareas), observacion || null],
    (err) => {
      if (err) {
        return res.status(500).json({ message: "Error guardando aseo" });
      }
      res.json({ message: "Aseo registrado" });
    }
  );
});

/* ==========================
   HISTORIAL ASEO
========================== */
app.get("/reporte-aseo", (req, res) => {
  const { desde, hasta, turno } = req.query;

  let sql = `
    SELECT a.fecha, a.turno, l.nombre AS lavador, a.tareas, a.observacion
    FROM aseo a
    JOIN lavadores l ON a.lavador_id = l.id
    WHERE 1=1
  `;
  const params = [];

  if (desde) {
    sql += " AND a.fecha >= ?";
    params.push(desde);
  }
  if (hasta) {
    sql += " AND a.fecha <= ?";
    params.push(hasta);
  }
  if (turno) {
    sql += " AND a.turno = ?";
    params.push(turno);
  }

  sql += " ORDER BY a.fecha DESC";

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ message: "Error reporte aseo" });
    }
    res.json(rows);
  });
});

/* ==========================
   INICIAR SERVIDOR
========================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});