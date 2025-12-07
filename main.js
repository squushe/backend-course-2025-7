const { program } = require("commander");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const mysql = require("mysql2/promise");
require("dotenv").config();

program
  .option("-H, --host <host>", "Server host", process.env.HOST || "0.0.0.0")
  .option("-p, --port <port>", "Server port", process.env.PORT || 3000)
  .option(
    "-c, --cache <path>",
    "Cache directory",
    process.env.CACHE_PATH || "cache"
  );

program.parse();
const options = program.opts();

const app = express();
const port = options.port;

app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(options.cache)) {
  fs.mkdirSync(options.cache, { recursive: true });
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function connectWithRetry() {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const conn = await pool.getConnection();
      console.log("Connected to MySQL");
      conn.release();
      return;
    } catch (err) {
      retries += 1;
      console.error(`MySQL error (${retries}/${maxRetries}):`, err.code);
      if (retries < maxRetries) {
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
  }
}

connectWithRetry();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, options.cache);
  },
  filename: function (req, file, cb) {
    const suffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + suffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Inventory Service API",
      version: "1.0.0",
    },
    servers: [{ url: `http://${options.host}:${options.port}` }],
  },
  apis: [__filename],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @openapi
 * /register:
 *   post:
 *     tags:
 *       - Inventory
 *     summary: Register a new inventory item
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Item created
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
app.post("/register", upload.single("photo"), async (req, res) => {
  try {
    const { inventory_name, description } = req.body;
    if (!inventory_name) {
      return res.status(400).json({ message: "inventory_name required" });
    }

    const newId = uuidv4();
    const photo = req.file ? req.file.filename : null;

    await pool.query(
      "INSERT INTO items (id, inventory_name, description, photo) VALUES (?, ?, ?, ?)",
      [newId, inventory_name, description || "", photo]
    );

    res.status(201).json({
      id: newId,
      inventory_name,
      description: description || "",
      photo,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @openapi
 * /inventory:
 *   get:
 *     tags:
 *       - Inventory
 *     summary: Get all inventory items
 *     responses:
 *       200:
 *         description: List of items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   inventory_name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   photo_url:
 *                     type: string
 *       500:
 *         description: Server error
 */
app.get("/inventory", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM items");

    const result = rows.map((item) => ({
      id: item.id,
      inventory_name: item.inventory_name,
      description: item.description,
      photo_url: item.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${item.id}/photo`
        : null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @openapi
 * /inventory/{id}:
 *   get:
 *     tags:
 *       - Inventory
 *     summary: Get inventory item by ID
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item found
 *       404:
 *         description: Not found
 */
app.get("/inventory/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM items WHERE id = ?", [
      req.params.id,
    ]);

    if (!rows.length) {
      return res.status(404).json({ message: "Not found" });
    }

    const item = rows[0];
    item.photo_url = item.photo
      ? `${req.protocol}://${req.get("host")}/inventory/${item.id}/photo`
      : null;

    res.json(item);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @openapi
 * /inventory/{id}:
 *   put:
 *     tags:
 *       - Inventory
 *     summary: Update inventory item
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */
app.put("/inventory/:id", async (req, res) => {
  try {
    const { inventory_name, description } = req.body;
    const id = req.params.id;

    const [exists] = await pool.query("SELECT id FROM items WHERE id = ?", [
      id,
    ]);
    if (!exists.length) {
      return res.status(404).json({ message: "Not found" });
    }

    let query = "UPDATE items SET ";
    const args = [];

    if (inventory_name) {
      query += "inventory_name = ?, ";
      args.push(inventory_name);
    }
    if (description) {
      query += "description = ?, ";
      args.push(description);
    }

    query = query.slice(0, -2) + " WHERE id = ?";
    args.push(id);

    if (args.length > 1) {
      await pool.query(query, args);
    }

    const [rows] = await pool.query("SELECT * FROM items WHERE id = ?", [id]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @openapi
 * /inventory/{id}:
 *   delete:
 *     tags:
 *       - Inventory
 *     summary: Delete item by ID
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
app.delete("/inventory/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const [rows] = await pool.query("SELECT photo FROM items WHERE id = ?", [
      id,
    ]);
    if (!rows.length) {
      return res.status(404).json({ message: "Not found" });
    }

    const photo = rows[0].photo;
    await pool.query("DELETE FROM items WHERE id = ?", [id]);

    if (photo) {
      const fullPath = path.join(options.cache, photo);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }

    res.json({ message: "Deleted" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @openapi
 * /inventory/{id}/photo:
 *   get:
 *     tags:
 *       - Inventory
 *     summary: Get item photo
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Photo
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Not found
 */
app.get("/inventory/:id/photo", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT photo FROM items WHERE id = ?", [
      req.params.id,
    ]);

    if (!rows.length || !rows[0].photo) {
      return res.status(404).json({ message: "Not found" });
    }

    const file = path.join(__dirname, options.cache, rows[0].photo);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ message: "Missing file" });
    }

    res.sendFile(file);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @openapi
 * /inventory/{id}/photo:
 *   put:
 *     tags:
 *       - Inventory
 *     summary: Update item photo
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: No photo uploaded
 *       404:
 *         description: Not found
 */
app.put("/inventory/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No photo" });
    }

    const id = req.params.id;

    const [rows] = await pool.query("SELECT photo FROM items WHERE id = ?", [
      id,
    ]);
    if (!rows.length) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: "Not found" });
    }

    const oldPhoto = rows[0].photo;
    if (oldPhoto) {
      const oldPath = path.join(options.cache, oldPhoto);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await pool.query("UPDATE items SET photo = ? WHERE id = ?", [
      req.file.filename,
      id,
    ]);

    const [updated] = await pool.query("SELECT * FROM items WHERE id = ?", [
      id,
    ]);
    res.json(updated[0]);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * @openapi
 * /search:
 *   post:
 *     tags:
 *       - Inventory
 *     summary: Search item by ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               has_photo:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Found
 *       404:
 *         description: Not found
 */
app.post("/search", async (req, res) => {
  try {
    const { id, has_photo } = req.body;

    const [rows] = await pool.query("SELECT * FROM items WHERE id = ?", [id]);

    if (!rows.length) {
      return res.status(404).json({ message: "Not found" });
    }

    const item = rows[0];

    if (has_photo && item.photo) {
      const url = `${req.protocol}://${req.get("host")}/inventory/${
        item.id
      }/photo`;
      item.description += `\nPhoto: ${url}`;
    }

    res.json(item);
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

app.listen(port, options.host, () => {
  console.log(`Server running at http://${options.host}:${port}`);
});
