const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');




const app = express();
const PORT = 3000;

// Esto se agrego para el chatbot

const http = require('http').createServer(app);
const io = require('socket.io')(http);

// === Middlewares ===
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// === Servir archivos estáticos ===
app.use(express.static(path.join(__dirname, '../public')));
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

const discografiaPaths = {
  portadas: path.join(__dirname, 'uploads/discografia/portadas'),
  contraportadas: path.join(__dirname, 'uploads/discografia/contraportadas'),
  canciones: path.join(__dirname, 'uploads/discografia/canciones'),
};

Object.values(discografiaPaths).forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});


const discografiaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'portada') cb(null, discografiaPaths.portadas);
    else if (file.fieldname === 'contraportada') cb(null, discografiaPaths.contraportadas);
    else if (file.fieldname === 'cancionAudio[]') cb(null, discografiaPaths.canciones);
  },
  filename: (req, file, cb) => {
    const nombre = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, nombre);
  }
});

const discografiaUpload = multer({ storage: discografiaStorage });


// === Configurar multer ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// === Base de datos ===
const db = new sqlite3.Database('./database.sqlite');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    descripcion TEXT,
    fecha TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS articulos_prensa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT,
    resumen TEXT,
    imagen TEXT,
    contenido TEXT,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS obras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT,
    descripcion TEXT,
    medidas TEXT,
    materiales TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS imagenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obra_id INTEGER,
    ruta TEXT,
    FOREIGN KEY (obra_id) REFERENCES obras(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT,
  user_id INTEGER,
  mensaje TEXT,
  emisor TEXT, -- 'cliente' o 'admin'
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
  db.run(`CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  portada TEXT,
  contraportada TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS canciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER,
  titulo TEXT NOT NULL,
  archivo TEXT,
  FOREIGN KEY (album_id) REFERENCES albums(id)
)`);

});

// === RUTAS ===

// Ruta base
app.get('/api', (req, res) => {
  res.send('Servidor API corriendo correctamente ✅');
});

// Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, user) => {
    if (user) res.send(`Bienvenido ${user.email} - Rol: ${user.role}`);
    else res.status(401).send('Login fallido');
  });
});

// Pedidos
app.post('/agregar-pedido', (req, res) => {
  const { user_id, descripcion } = req.body;
  const fecha = new Date().toISOString();
  db.run('INSERT INTO pedidos (user_id, descripcion, fecha) VALUES (?, ?, ?)', [user_id, descripcion, fecha], function(err) {
    if (err) return res.status(500).send('Error al registrar pedido');
    res.send('Pedido registrado correctamente');
  });
});

app.get('/todos-pedidos', (req, res) => {
  db.all('SELECT * FROM pedidos', [], (err, rows) => {
    if (err) res.status(500).send('Error al obtener los pedidos');
    else res.json(rows);
  });
});

// Artículos de prensa
app.post('/agregar-articulo', (req, res) => {
  const { titulo, resumen, imagen, contenido } = req.body;
  db.run('INSERT INTO articulos_prensa (titulo, resumen, imagen, contenido) VALUES (?, ?, ?, ?)',
    [titulo, resumen, imagen, contenido],
    function(err) {
      if (err) res.status(500).send('Error al agregar el artículo');
      else res.send('Artículo agregado correctamente');
    });
});

app.get('/articulos-prensa', (req, res) => {
  db.all('SELECT * FROM articulos_prensa ORDER BY fecha DESC', [], (err, rows) => {
    if (err) {
      res.status(500).send('Error al obtener artículos');
    } else {
      const baseUrl = `${req.protocol}://${req.headers.host}`;
      const articulos = rows.map(row => {
        if (row.imagen && !row.imagen.startsWith('http')) {
          const nombreImagen = path.basename(row.imagen);
          row.imagen = `${baseUrl}/uploads/${nombreImagen}`;
        }
        return row;
      });
      res.json(articulos);
    }
  });
});

app.put('/actualizar-articulo/:id', (req, res) => {
  const { titulo, resumen, imagen, contenido } = req.body;
  db.run('UPDATE articulos_prensa SET titulo = ?, resumen = ?, imagen = ?, contenido = ? WHERE id = ?',
    [titulo, resumen, imagen, contenido, req.params.id],
    function(err) {
      if (err) res.status(500).send('Error al actualizar artículo');
      else res.send('Artículo actualizado correctamente');
    });
});

app.delete('/eliminar-articulo/:id', (req, res) => {
  db.run('DELETE FROM articulos_prensa WHERE id = ?', [req.params.id], function(err) {
    if (err) res.status(500).send('Error al eliminar artículo');
    else res.send('Artículo eliminado correctamente');
  });
});

// Obras
app.post('/api/obras', upload.array('imagenes[]'), (req, res) => {
  const { titulo, descripcion, medidas, materiales } = req.body;
  const imagenes = req.files;
  if (!imagenes || imagenes.length === 0) return res.status(400).send('No se recibieron imágenes');

  db.run(`INSERT INTO obras (titulo, descripcion, medidas, materiales) VALUES (?, ?, ?, ?)`,
    [titulo, descripcion, medidas, materiales],
    function(err) {
      if (err) return res.status(500).send(err);
      const obraId = this.lastID;
      const insertImg = db.prepare(`INSERT INTO imagenes (obra_id, ruta) VALUES (?, ?)`);
      imagenes.forEach(img => insertImg.run(obraId, img.filename));
      insertImg.finalize();
      res.json({ message: 'Obra guardada', id: obraId });
    });
});

app.get('/api/obras', (req, res) => {
  const baseUrl = `${req.protocol}://${req.headers.host}`;

  db.all('SELECT * FROM obras', [], (err, obras) => {
    if (err) {
      console.error('Error al obtener obras:', err);
      res.status(500).json({ error: 'Error al obtener obras' });
      return;
    }

    const obrasConImagenes = [];

    let pending = obras.length;
    if (pending === 0) return res.json([]);

    obras.forEach((obra) => {
      db.all('SELECT ruta FROM imagenes WHERE obra_id = ?', [obra.id], (err2, imagenes) => {
        if (err2) {
          console.error('Error al obtener imágenes:', err2);
          res.status(500).json({ error: 'Error al obtener imágenes' });
          return;
        }

        const imagenesConUrl = imagenes.map(img => `${baseUrl}/uploads/${img.ruta}`);

        obrasConImagenes.push({
          ...obra,
          imagenes: imagenesConUrl
        });

        pending--;
        if (pending === 0) {
          res.json(obrasConImagenes);
        }
      });
    });
  });
});






app.put('/actualizar-obra/:id', (req, res) => {
  const { titulo, descripcion, medidas, materiales } = req.body;
  db.run(`UPDATE obras SET titulo = ?, descripcion = ?, medidas = ?, materiales = ? WHERE id = ?`,
    [titulo, descripcion, medidas, materiales, req.params.id],
    function(err) {
      if (err) return res.status(500).send('Error al actualizar obra');
      res.send('Obra actualizada correctamente');
    });
});

app.delete('/api/obras/:id', (req, res) => {
  db.serialize(() => {
    db.run(`DELETE FROM imagenes WHERE obra_id = ?`, [req.params.id], (err) => {
      if (err) return res.status(500).send(err);
      db.run(`DELETE FROM obras WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ message: 'Obra eliminada' });
      });
    });
  });
});

// Últimos artículos con URL dinámica
app.get('/ultimos-articulos', (req, res) => {
  db.all('SELECT * FROM articulos_prensa ORDER BY id DESC LIMIT 3', (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al obtener los artículos' });
    } else {
      const baseUrl = `${req.protocol}://${req.headers.host}`;
      const articulos = rows.map(row => {
        if (row.imagen && !row.imagen.startsWith('http')) {
          const nombreImagen = path.basename(row.imagen);
          row.imagen = `${baseUrl}/uploads/${nombreImagen}`;
        }
        return row;
      });
      res.json(articulos);
    }
  });
});

// Subida de imágenes desde admin-prensa
app.post('/subir-imagen', upload.single('imagen'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió archivo' });
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});


//Esto es para el chatbot

const clientesConectados = {}; // clientId → socket.id

io.on('connection', socket => {
  let clientId = null;

  socket.on('identificar', id => {
    clientId = id;
    clientesConectados[clientId] = socket.id;

    console.log(`Cliente conectado: ${clientId}`);

    // Cargar historial
    db.all('SELECT * FROM mensajes WHERE client_id = ? ORDER BY fecha ASC', [clientId], (err, rows) => {
      if (!err && rows) {
        rows.forEach(row => {
          socket.emit(row.emisor === 'admin' ? 'adminMessage' : 'clientMessage', row.mensaje);
        });
      }
    });
  });

  socket.on('clientMessage', msg => {
    if (!clientId) return;
    console.log(`Cliente [${clientId}] dice: ${msg}`);
    db.run(`INSERT INTO mensajes (client_id, mensaje, emisor) VALUES (?, ?, ?)`, [clientId, msg, 'cliente']);
    
    // Reenviar al admin
    io.emit('clientMessageToAdmin', { clientId, mensaje: msg });
  });

  socket.on('adminMessageTo', ({ clientId: destinoId, mensaje }) => {
    console.log(`Admin responde a [${destinoId}]: ${mensaje}`);
    db.run(`INSERT INTO mensajes (client_id, mensaje, emisor) VALUES (?, ?, ?)`, [destinoId, mensaje, 'admin']);

    const destinoSocket = clientesConectados[destinoId];
    if (destinoSocket) {
      io.to(destinoSocket).emit('adminMessage', mensaje);
    } else {
      console.log(`Cliente ${destinoId} no conectado`);
    }
  });

  socket.on('disconnect', () => {
    if (clientId && clientesConectados[clientId] === socket.id) {
      delete clientesConectados[clientId];
      console.log(`Cliente desconectado: ${clientId}`);
    }
  });
});

const nodemailer = require('nodemailer');


// Ruta para recibir checkout y enviar correo
app.post('/enviar-confirmacion', async (req, res) => {
  const { nombre, correo, direccion, carrito } = req.body;

  // Configurar transporte SMTP con Gmail
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const listaProductos = carrito.map(item => `• ${item.nombre} x${item.cantidad} - $${item.precio * item.cantidad} MXN`).join('\n');
  const total = carrito.reduce((sum, item) => sum + item.precio * item.cantidad, 0);

  const mailOptions = {
    from: '"Alfredo Juarez" <alfredojuarezcastellanos@gmail.com>',
    to: correo,
    subject: 'Confirmación de tu pedido - Alfredo Juarez',
    text: `Hola ${nombre},\n\nGracias por tu compra. Estos son los detalles de tu pedido:\n\n${listaProductos}\n\nTotal: $${total} MXN\n\nEnviaremos el pedido a:\n${direccion}\n\n¡Gracias por tu apoyo!\n- Alfredo Juarez`
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'Correo enviado con éxito.' });
  } catch (error) {
    console.error('Error al enviar correo:', error);
    res.status(500).json({ success: false, error: 'No se pudo enviar el correo.' });
  }
});

//Album

app.post('/api/discografia', discografiaUpload.fields([
  { name: 'portada', maxCount: 1 },
  { name: 'contraportada', maxCount: 1 },
  { name: 'cancionAudio[]' }
]), (req, res) => {
  const { titulo, descripcion, cancionTitulo } = req.body;

  const portada = req.files['portada']?.[0]?.filename || '';
const contraportada = req.files['contraportada']?.[0]?.filename || '';
const cancionesArchivos = req.files['cancionAudio[]'] || [];

  db.run(
    `INSERT INTO albums (titulo, descripcion, portada, contraportada) VALUES (?, ?, ?, ?)`,
    [
  titulo,
  descripcion,
  `uploads/discografia/portadas/${portada}`,
  `uploads/discografia/contraportadas/${contraportada}`
]
,
    function (err) {
      if (err) return res.status(500).json({ error: 'Error al guardar álbum' });

      const albumId = this.lastID;
      const titulos = Array.isArray(cancionTitulo) ? cancionTitulo : [cancionTitulo];

      const stmt = db.prepare(`INSERT INTO canciones (album_id, titulo, archivo) VALUES (?, ?, ?)`);
      for (let i = 0; i < titulos.length; i++) {
        const archivo = `uploads/discografia/canciones/${cancionesArchivos[i]?.filename || ''}`;
stmt.run(albumId, titulos[i], archivo);

      }
      stmt.finalize();

      res.json({ mensaje: 'Álbum guardado correctamente' });
    }
  );
});

app.get('/api/discografia', (req, res) => {
  const baseUrl = `${req.protocol}://${req.headers.host}`;

  db.all('SELECT * FROM albums', [], (err, albums) => {
    if (err) return res.status(500).json({ error: 'Error al obtener álbumes' });

    let pendientes = albums.length;
    const resultado = [];

    if (pendientes === 0) return res.json([]);

    albums.forEach(album => {
      db.all('SELECT * FROM canciones WHERE album_id = ?', [album.id], (err2, canciones) => {
        if (err2) return res.status(500).json({ error: 'Error al obtener canciones' });

        resultado.push({
          ...album,
          portada: `${baseUrl}/${album.portada.replace(/\\/g, '/')}`,
          contraportada: `${baseUrl}/${album.contraportada.replace(/\\/g, '/')}`,
          canciones: canciones.map(c => ({
            titulo: c.titulo,
            archivo: `${baseUrl}/${c.archivo.replace(/\\/g, '/')}`
          }))
        });

        pendientes--;
        if (pendientes === 0) {
          res.json(resultado);
        }
      });
    });
  });
});

app.delete('/api/discografia/:id', (req, res) => {
  const albumId = req.params.id;

  db.serialize(() => {
    db.run('DELETE FROM canciones WHERE album_id = ?', [albumId], err => {
      if (err) return res.status(500).json({ error: 'Error al eliminar canciones' });

      db.run('DELETE FROM albums WHERE id = ?', [albumId], err2 => {
        if (err2) return res.status(500).json({ error: 'Error al eliminar álbum' });

        res.json({ message: 'Álbum eliminado correctamente' });
      });
    });
  });
});

app.put('/api/discografia/:id', discografiaUpload.fields([
  { name: 'portada', maxCount: 1 },
  { name: 'contraportada', maxCount: 1 },
  { name: 'cancionAudio[]' }
]), (req, res) => {
  const albumId = req.params.id;
  const { titulo, descripcion, cancionTitulo } = req.body;

  const portada = req.files['portada']?.[0]?.filename;
  const contraportada = req.files['contraportada']?.[0]?.filename;
  const nuevasCanciones = req.files['cancionAudio[]'] || [];

  // 1. Actualizar título y descripción (y portada si viene)
  db.run(
    `UPDATE albums SET titulo = ?, descripcion = ?, portada = COALESCE(?, portada), contraportada = COALESCE(?, contraportada) WHERE id = ?`,
    [titulo, descripcion, portada ? `uploads/discografia/portadas/${portada}` : null, contraportada ? `uploads/discografia/contraportadas/${contraportada}` : null, albumId],
    function (err) {
      if (err) return res.status(500).json({ error: 'Error al actualizar álbum' });

      // 2. Si se subieron nuevas canciones, eliminamos las anteriores y agregamos nuevas
      if (nuevasCanciones.length > 0) {
        db.run('DELETE FROM canciones WHERE album_id = ?', [albumId], err2 => {
          if (err2) return res.status(500).json({ error: 'Error al eliminar canciones antiguas' });

          const titulos = Array.isArray(cancionTitulo) ? cancionTitulo : [cancionTitulo];
          const stmt = db.prepare('INSERT INTO canciones (album_id, titulo, archivo) VALUES (?, ?, ?)');
          for (let i = 0; i < titulos.length; i++) {
            const archivo = `uploads/discografia/canciones/${nuevasCanciones[i]?.filename || ''}`;
            stmt.run(albumId, titulos[i], archivo);
          }
          stmt.finalize();

          res.json({ mensaje: 'Álbum actualizado con canciones nuevas' });
        });
      } else {
        res.json({ mensaje: 'Álbum actualizado (sin cambios de canciones)' });
      }
    }
  );
});


http.listen(3000, () => {
  console.log('Servidor escuchando en http://localhost:3000');
});


