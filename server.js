const express = require("express");
const cors = require("cors");
const path = require("path");
const QRCode = require("qrcode");
const db = require("./db"); // 👈 MYSQL
db.query("...");
const app = express();

/* ==========================
   MIDDLEWARES
========================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ==========================
   SERVIDOR OK
========================== */
app.get("/", (req, res) => {
  res.send("Servidor funcionando ✅");
});

/* ==========================
   LOGIN
========================== */
app.post("/login", (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const sql = `
    SELECT id, usuario, rol
    FROM usuarios
    WHERE usuario = $1 AND password = $2 AND activo = true
    LIMIT 1
  `;

  db.query(sql, [usuario, password], (err, result) => {
    if (err) {
      console.error("❌ Error login:", err);
      return res.status(500).json({ message: "Error servidor" });
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }

    res.json(result.rows[0]);
  });
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

  db.query(sql, params, (err, rows) => {
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

  db.query(
    "INSERT INTO lavadores (nombre, turno) VALUES (?, ?)",
    [nombre, turno],
    (err, result) => {
      if (err) {
        return res.status(500).json({ message: "Error creando lavador" });
      }
      res.json({ id: result.insertId, nombre, turno });
    }
  );
});

/* ==========================
   QR LAVADOR
========================== */
app.get("/lavadores/:id/qr", async (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM lavadores WHERE id = ?", [id], async (err, rows) => {
    if (!rows.length) {
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

  db.query(
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

  db.query(sql, params, (err, rows) => {
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