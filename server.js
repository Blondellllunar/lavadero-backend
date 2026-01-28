const express = require("express");
const cors = require("cors");
const path = require("path");
const QRCode = require("qrcode");
const db = require("./db");

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
    WHERE usuario = ? AND password = ? AND activo = 1
  `;

  db.query(sql, [usuario, password], (err, rows) => {
    if (err) {
      console.error("❌ Login error:", err);
      return res.status(500).json({ message: "Error servidor" });
    }

    if (rows.length === 0) {
      return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
    }

    res.json(rows[0]);
  });
});

/* ==========================
   LAVADORES
========================== */

// Obtener lavadores
app.get("/lavadores", (req, res) => {
  const turno = req.query.turno;

  let sql = "SELECT id, nombre, turno FROM lavadores";
  const params = [];

  if (turno && turno !== "admin") {
    sql += " WHERE turno = ?";
    params.push(turno);
  }

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("❌ Error lavadores:", err);
      return res.status(500).json({ message: "Error lavadores" });
    }
    res.json(rows);
  });
});

// Crear lavador
app.post("/lavadores", (req, res) => {
  let { nombre, turno } = req.body;

  nombre = nombre ? nombre.trim() : "";
  turno = turno ? turno.trim() : "";

  if (!nombre || !turno) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  if (turno !== "dia" && turno !== "noche") {
    return res.status(400).json({ message: "Turno inválido" });
  }

  const checkSql = `
    SELECT id FROM lavadores
    WHERE nombre = ? AND turno = ?
    LIMIT 1
  `;

  db.query(checkSql, [nombre, turno], (err, rows) => {
    if (err) {
      console.error("❌ Error validando lavador:", err);
      return res.status(500).json({ message: "Error servidor" });
    }

    if (rows.length > 0) {
      return res.status(409).json({ message: "El lavador ya existe en ese turno" });
    }

    const insertSql = `
      INSERT INTO lavadores (nombre, turno)
      VALUES (?, ?)
    `;

    db.query(insertSql, [nombre, turno], (err, result) => {
      if (err) {
        console.error("❌ Error creando lavador:", err);
        return res.status(500).json({ message: "Error creando lavador" });
      }

      res.json({
        message: "Lavador creado correctamente",
        lavador: {
          id: result.insertId,
          nombre,
          turno
        }
      });
    });
  });
});

// Generar QR de lavador
app.get("/lavadores/:id/qr", (req, res) => {
  const { id } = req.params;

  const sql = "SELECT id, nombre FROM lavadores WHERE id = ?";

  db.query(sql, [id], async (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(404).json({ message: "Lavador no encontrado" });
    }

    const lavador = rows[0];
    const url = `http://localhost:3000/aseo-qr.html?token=${lavador.id}`;

    try {
      const qr = await QRCode.toDataURL(url);
      res.json({ qr, url });
    } catch (e) {
      console.error("❌ Error QR:", e);
      res.status(500).json({ message: "Error generando QR" });
    }
  });
});

/* ==========================
   ENTREGAS
========================== */

// Guardar entrega
app.post("/entregas", (req, res) => {
  let {
    fecha,
    turno,
    lavador_id,
    producto,
    cantidad,
    observacion,
    registrado_por
  } = req.body;

  lavador_id = Number(lavador_id);
  cantidad = Number(cantidad);
  registrado_por = registrado_por ? Number(registrado_por) : null;

  if (!fecha || !turno || !lavador_id || !producto || !cantidad) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  if (turno !== "dia" && turno !== "noche") {
    return res.status(400).json({ message: "Turno inválido" });
  }

  const hoy = new Date().toISOString().split("T")[0];
  if (fecha > hoy) {
    return res.status(400).json({ message: "No se permiten fechas futuras" });
  }

  const sql = `
    INSERT INTO entregas
    (fecha, turno, lavador_id, producto, cantidad, observacion, registrado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [fecha, turno, lavador_id, producto, cantidad, observacion || null, registrado_por],
    (err) => {
      if (err) {
        console.error("❌ Error guardando entrega:", err);
        return res.status(500).json({ message: "Error guardando entrega" });
      }

      res.json({ message: "Entrega registrada correctamente" });
    }
  );
});

// Historial de entregas
app.get("/reporte-entregas", (req, res) => {
  const { desde, hasta, turno } = req.query;

  let sql = `
    SELECT
      DATE_FORMAT(e.fecha, '%Y-%m-%d') AS fecha,
      e.turno,
      l.nombre AS lavador,
      e.producto,
      e.cantidad,
      e.observacion
    FROM entregas e
    JOIN lavadores l ON e.lavador_id = l.id
    WHERE 1=1
  `;

  const params = [];

  if (desde) {
    sql += " AND DATE(e.fecha) >= ?";
    params.push(desde);
  }

  if (hasta) {
    sql += " AND DATE(e.fecha) <= ?";
    params.push(hasta);
  }

  if (turno) {
    sql += " AND e.turno = ?";
    params.push(turno);
  }

  sql += " ORDER BY e.fecha DESC";

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("❌ Error reporte entregas:", err);
      return res.status(500).json({ message: "Error reporte entregas" });
    }

    res.json(rows);
  });
});

/* ==========================
   ASEO
========================== */

// Registrar aseo
app.post("/aseo", (req, res) => {
  const { fecha, turno, lavador_id, tareas, observacion } = req.body;

  if (!turno || !lavador_id || !Array.isArray(tareas) || tareas.length === 0) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const sql = `
    INSERT INTO aseo (fecha, turno, lavador_id, tareas, observacion)
    VALUES (NOW(), ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [turno, lavador_id, JSON.stringify(tareas), observacion || null],
    (err) => {
      if (err) {
        console.error("❌ Error guardando aseo:", err);
        return res.status(500).json({ message: "Error guardando aseo" });
      }

      res.json({ message: "Aseo registrado con éxito" });
    }
  );
});

// Historial de aseo
app.get("/reporte-aseo", (req, res) => {
  const { desde, hasta, turno, lavador_id } = req.query;

  let sql = `
    SELECT
      DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha,
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
    sql += " AND DATE(a.fecha) >= ?";
    params.push(desde);
  }

  if (hasta) {
    sql += " AND DATE(a.fecha) <= ?";
    params.push(hasta);
  }

  if (turno) {
    sql += " AND a.turno = ?";
    params.push(turno);
  }

  if (lavador_id) {
    sql += " AND l.id = ?";
    params.push(lavador_id);
  }

  sql += " ORDER BY a.fecha DESC";

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("❌ Error reporte aseo:", err);
      return res.status(500).json({ message: "Error reporte aseo" });
    }

    res.json(rows);
  });
});
// ⚠️ RUTA TEMPORAL PARA CREAR ADMIN
app.get("/crear-admin", (req, res) => {
  const sql = `
    INSERT INTO usuarios (usuario, password, rol, activo)
    VALUES ('admin', '1234', 'admin', 1)
  `;

  db.run(sql, function (err) {
    if (err) {
      return res.json({ error: err.message });
    }
    res.json({
      message: "Usuario admin creado",
      usuario: "admin",
      password: "1234"
    });
  });
});

// ⬇️ ESTO YA EXISTE, NO LO BORRES
app.listen(3000, () => {
  console.log("🚀 Servidor en http://localhost:3000");
});
/* ==========================
   INICIAR SERVIDOR
========================== */
app.listen(3000, () => {
  console.log("🚀 Servidor en http://localhost:3000");
});