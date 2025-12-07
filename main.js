const { program } = require("commander");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

program
  .requiredOption("-H, --host <host>")
  .requiredOption("-p, --port <port>")
  .requiredOption("-c, --cache <path>");

program.parse();
const options = program.opts();
const app = express();
const port = options.port;

app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(options.cache)) {
  fs.mkdirSync(options.cache, { recursive: true });
  console.log("Директорію створено");
}

const dbPath = path.join(options.cache, "data.json");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, options.cache);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage: storage });

function readData() {
  if (!fs.existsSync(dbPath)) return [];
  const data = fs.readFileSync(dbPath);
  return JSON.parse(data);
}

function writeData(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Конфігурація Swagger
const swaggerOptions = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "Inventory Service API",
      version: "1.0.0",
      description: "API for invetory service",
    },
    servers: [
      {
        url: `http://${options.host}:${options.port}`,
      },
    ],
  },
  apis: ["./main.js"],
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new inventory item
 *     tags: [Inventory]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *                 description: The name of the item (required).
 *               description:
 *                 type: string
 *                 description: A description of the item.
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: The item's photo file.
 *     responses:
 *       201:
 *         description: Item created successfully.
 *       400:
 *         description: Bad request, inventory_name is required.
 */

app.post("/register", upload.single("photo"), (req, res) => {
  const { inventory_name, description } = req.body;

  if (!inventory_name) {
    return res
      .status(400)
      .json({ message: "Поле inventory_name є обов'язковим" });
  }

  const inventories = readData();

  const newInventory = {
    id: uuidv4(),
    inventory_name: inventory_name,
    description: description || "",
    photo: req.file ? req.file.filename : null,
  };

  inventories.push(newInventory);
  writeData(inventories);

  res.status(201).json(newInventory);
});

app.all("/register", (req, res) => {
  res.status(405).json({ message: "Method Not Allowed" });
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Retrieve a list of all inventory items
 *     tags: [Inventory]
 *     responses:
 *       200:
 *         description: A list of inventory items.
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
 *                     format: uri
 */

app.get("/inventory", (req, res) => {
  const allItems = readData();
  const itemsWithLinks = allItems.map((item) => {
    return {
      id: item.id,
      inventory_name: item.inventory_name,
      description: item.description,
      photo_url: item.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${item.id}/photo`
        : null,
    };
  });
  res.status(200).json(itemsWithLinks);
});
app.all("/inventory", (req, res) => {
  res.status(405).json({ message: "Method Not Allowed" });
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Get a single inventory item by ID
 *     tags: [Inventory]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the item.
 *     responses:
 *       200:
 *         description: The inventory item details.
 *       404:
 *         description: Item with the specified ID not found.
 */

app.get("/inventory/:id", (req, res) => {
  const allItems = readData();
  id = req.params.id;
  const findItem = allItems.find((item) => {
    return item.id === id;
  });
  if (findItem) {
    const itemWithLink = {
      ...findItem,
      photo_url: findItem.photo
        ? `${req.protocol}://${req.get("host")}/inventory/${findItem.id}/photo`
        : null,
    };
    res.status(200).json(itemWithLink);
  } else {
    res.status(404).json({ message: "Річ з таким ID не знайдено" });
  }
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Update an item's name or description
 *     tags: [Inventory]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the item.
 *     requestBody:
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
 *         description: Item updated successfully.
 *       404:
 *         description: Item with the specified ID not found.
 */

app.put("/inventory/:id", (req, res) => {
  const allItems = readData();
  const id = req.params.id;
  const { inventory_name, description } = req.body;

  const findIndex = allItems.findIndex((item) => {
    return item.id === id;
  });

  if (findIndex !== -1) {
    if (inventory_name) {
      allItems[findIndex].inventory_name = inventory_name;
    }
    if (description) {
      allItems[findIndex].description = description;
    }
    writeData(allItems);
    res.status(200).json(allItems[findIndex]);
  } else {
    res.status(404).json({ message: "Річ з таким ID не знайдено" });
  }
});

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Delete an inventory item by ID
 *     tags: [Inventory]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the item to delete.
 *     responses:
 *       200:
 *         description: Item deleted successfully.
 *       404:
 *         description: Item with the specified ID not found.
 */

app.delete("/inventory/:id", (req, res) => {
  const allItems = readData();
  const id = req.params.id;
  const findIndex = allItems.findIndex((item) => {
    return item.id === id;
  });

  if (findIndex !== -1) {
    const itemToDelete = allItems[findIndex];
    if (itemToDelete.photo) {
      const pathToPhoto = path.join(options.cache, itemToDelete.photo);
      fs.unlinkSync(pathToPhoto);
      console.log("Пов'язане фото видалено:", pathToPhoto);
    }
    allItems.splice(findIndex, 1);
    writeData(allItems);
    res.status(200).json({ message: "Річ успішно видалено" });
  } else {
    res.status(404).json({ message: "Річ з таким ID не знайдено" });
  }
});

app.all("/inventory/:id", (req, res) => {
  res.status(405).json({ message: "Method Not Allowed" });
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Get the photo of a specific item
 *     tags: [Inventory]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the item.
 *     responses:
 *       200:
 *         description: The item's photo file.
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Item or photo not found.
 */

app.get("/inventory/:id/photo", (req, res) => {
  const allItems = readData();
  const id = req.params.id;
  const findItem = allItems.find((item) => {
    return item.id === id;
  });
  if (findItem) {
    if (findItem.photo) {
      const photoPath = path.join(__dirname, options.cache, findItem.photo);
      if (fs.existsSync(photoPath)) {
        res.sendFile(photoPath);
      } else {
        res.status(404).json({ message: "Немає фото" });
      }
    } else {
      res.status(404).json({ message: "Не було завантажено фото" });
    }
  } else {
    res.status(404).json({ message: "Річ з таким ID не знайдено" });
  }
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Update the photo of a specific item
 *     tags: [Inventory]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the item.
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
 *                 description: The new photo file.
 *     responses:
 *       200:
 *         description: Photo updated successfully.
 *       400:
 *         description: No photo file uploaded.
 *       404:
 *         description: Item with the specified ID not found.
 */

app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const allItems = readData();
  const id = req.params.id;
  if (!req.file) {
    return res.status(400).json({ message: "Файл фото не було завантажено" });
  }
  const findIndex = allItems.findIndex((item) => {
    return item.id === id;
  });
  if (findIndex !== -1) {
    const oldPhotoName = allItems[findIndex].photo;
    if (oldPhotoName) {
      const oldPhotoPath = path.join(options.cache, oldPhotoName);
      fs.unlinkSync(oldPhotoPath);
      console.log("Старе фото було видалено:", oldPhotoPath);
    }
    allItems[findIndex].photo = req.file.filename;
    writeData(allItems);
    res.status(200).json(allItems[findIndex]);
  } else {
    res.status(404).json({ message: "Річ з таким ID не знайдено" });
  }
});
app.all("/inventory/:id/photo", (req, res) => {
  res.status(405).json({ message: "Method Not Allowed" });
});

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search for an item by its ID
 *     tags: [Inventory]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 description: The ID of the item to find.
 *               has_photo:
 *                 type: boolean
 *                 description: If checked, appends the photo URL to the description.
 *     responses:
 *       200:
 *         description: The found item's information.
 *       404:
 *         description: Item with the specified ID not found.
 */

app.post("/search", (req, res) => {
  const allItems = readData();
  const { id, has_photo } = req.body;
  const findItem = allItems.find((item) => {
    return item.id === id;
  });
  if (findItem) {
    let itemToSend = { ...findItem };
    if (has_photo && itemToSend.photo) {
      const photoUrl = `${req.protocol}://${req.get("host")}/inventory/${
        itemToSend.id
      }/photo`;
      itemToSend.description = `${itemToSend.description}\nПосилання на фото: ${photoUrl}`;
    }
    res.status(200).json(itemToSend);
  } else {
    res.status(404).json({ message: "Річ з таким ID не знайдено" });
  }
});

app.all("/search", (req, res) => {
  res.status(405).json({ message: "Method Not Allowed" });
});
app.listen(options.port, options.host, () => {
  console.log(`Server running at http://${options.host}:${options.port}`);
});
