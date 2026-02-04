const express = require("express");
const cors = require("cors");
const path = require("path");
const QRCode = require("qrcode");
const db = require("./db"); // PostgreSQL pool

const app = express();

/* ==========================
   MIDDLEWARES
========================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ==========================
   TEST SERVER
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
    WHERE usuario = $1
      AND password = $2
      AND activo = true
    LIMIT 1
  `;

  db.query(sql, [usuario, password])
    .then(result => {
      if (result.rows.length === 0) {
        return res
          .status(401)
          .json({ message: "Usuario o contraseña incorrectos" });
      }

      res.json(result.rows[0]);
    })
    .catch(err => {
      console.error("❌ Error login:", err);
      res.status(500).json({ message: "Error servidor" });
    });
});

/* ==========================
   LAVADORES
========================== */
app.get("/lavadores", (req, res) => {
  const { turno } = req.query;

  let sql = "SELECT * FROM lavadores";
  const params = [];

  if (turno && turno !== "admin") {
    sql += " WHERE turno = $1";
    params.push(turno);
  }

  db.query(sql, params)
    .then(result => res.json(result.rows))
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: "Error lavadores" });
    });
});

app.post("/lavadores", (req, res) => {
  const { nombre, turno } = req.body;

  if (!nombre || !turno) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const sql = `
    INSERT INTO lavadores (nombre, turno)
    VALUES ($1, $2)
    RETURNING id
  `;

  db.query(sql, [nombre, turno])
    .then(result => {
      res.json({
        id: result.rows[0].id,
        nombre,
        turno
      });
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: "Error creando lavador" });
    });
});

/* ==========================
   GENERAR QR DE LAVADOR
========================== */

app.get("/lavadores/:id/qr", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      "SELECT id, nombre FROM lavadores WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Lavador no encontrado" });
    }

    // URL pública del backend (Render)
    const BASE_URL =
  process.env.BASE_URL || "https://lavadero-backend-lbol.onrender.com";

    const url = `${BASE_URL}/aseo-qr.html?lavador=${id}`;

    const qr = await QRCode.toDataURL(url);

    res.json({
      qr,
      url
    });

  } catch (err) {
    console.error("❌ Error generando QR:", err);
    res.status(500).json({ message: "No se pudo generar el QR" });
  }
});

/* ==========================
   REGISTRAR ASEO (CON CONTROL)
========================== */
app.post("/aseo", async (req, res) => {
  const { turno, lavador_id, tareas, observacion } = req.body;

  if (!turno || !lavador_id || !Array.isArray(tareas) || tareas.length === 0) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const fecha = new Date().toISOString().split("T")[0];

  try {
    await db.query(
      `
      INSERT INTO aseo (fecha, turno, lavador_id, tareas, observacion)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        fecha,
        turno,
        lavador_id,
        JSON.stringify(tareas),
        observacion || null
      ]
    );

    res.json({ message: "Aseo registrado con éxito" });

  } catch (err) {
    // 🔒 Aseo duplicado (mismo día)
    if (err.code === "23505") {
      return res.status(409).json({
        message: "⚠️ Ya registraste el aseo hoy"
      });
    }

    console.error("❌ Error guardando aseo:", err);
    res.status(500).json({ message: "Error guardando aseo" });
  }
});

/* ==========================
   HISTORIAL ASEO
========================== */
app.get("/reporte-aseo", (req, res) => {
  const { desde, hasta, turno } = req.query;

  let sql = `
    SELECT
      a.fecha,
      a.turno,
      l.nombre AS lavador,
      a.tareas,
      a.observacion
    FROM aseo a
    JOIN lavadores l ON a.lavador_id = l.id
    WHERE 1=1
  `;
  const params = [];

  if (desde) {
    params.push(desde);
    sql += ` AND a.fecha >= $${params.length}`;
  }
  if (hasta) {
    params.push(hasta);
    sql += ` AND a.fecha <= $${params.length}`;
  }
  if (turno) {
    params.push(turno);
    sql += ` AND a.turno = $${params.length}`;
  }

  sql += " ORDER BY a.fecha DESC";

  db.query(sql, params)
    .then(result => res.json(result.rows))
    .catch(err => {
      console.error(err);
      res.status(500).json({ message: "Error reporte aseo" });
    });
});
app.get("/debug-usuarios", async (req, res) => {
  try {
    const result = await db.query("SELECT id, usuario, password, rol, activo FROM usuarios");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ==========================
   INICIAR SERVIDOR
========================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});