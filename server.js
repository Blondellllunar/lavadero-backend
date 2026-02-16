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
        return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
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
   OBTENER LAVADOR POR ID
========================== */
app.get("/lavadores/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      "SELECT id, nombre, turno FROM lavadores WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Lavador no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error obteniendo lavador:", err);
    res.status(500).json({ message: "Error servidor" });
  }
});

/* ==========================
   ELIMINAR LAVADOR
========================== */
app.delete("/lavadores/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      "DELETE FROM lavadores WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Lavador no encontrado" });
    }

    res.json({ message: "Lavador eliminado correctamente" });
  } catch (err) {
    console.error("❌ Error eliminando lavador:", err);
    res.status(500).json({ message: "Error eliminando lavador" });
  }
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

    const BASE_URL =
      process.env.BASE_URL || "https://lavadero-backend-lbol.onrender.com";

    const url = `${BASE_URL}/aseo-qr.html?lavador=${id}`;
    const qr = await QRCode.toDataURL(url);

    res.json({ qr, url });

  } catch (err) {
    console.error("❌ Error generando QR:", err);
    res.status(500).json({ message: "No se pudo generar el QR" });
  }
});

/* ==========================
   REGISTRAR ASEO
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
      [fecha, turno, lavador_id, JSON.stringify(tareas), observacion || null]
    );

    res.json({ message: "Aseo registrado con éxito" });

  } catch (err) {
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
   INICIAR SERVIDOR
========================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en puerto ${PORT}`);
});