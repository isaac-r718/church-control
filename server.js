const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { execFile } = require('child_process');

const app = express();
const server = http.createServer(app);

server.requestTimeout = 15 * 60 * 1000; // permitir subidas de hasta 15 minutos

const io = new Server(server);

const PORT = 3000;
const MUSIC_DIR = path.join(__dirname, 'music');
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.opus', '.aac', '.flac', '.webm'];
// ---------- Configuración y PIN ----------
const config = require('./config.json'); // si el archivo no existe, Node mostrará "Cannot find module"
const PIN = String(config.pin || '');
if (!/^\d{4,8}$/.test(PIN)) {
  console.error('ERROR: config.json debe tener un "pin" de 4 a 8 dígitos. Ejemplo: { "pin": "483920" }');
  process.exit(1);
}

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // una sesión dura 24 horas
const MAX_ATTEMPTS = 5;                              // intentos fallidos permitidos
const LOCKOUT_MS = 5 * 60 * 1000;                    // bloqueo de 5 minutos

// ---------- Sesiones y PIN ----------
function parseCookies(header = '') {
  const cookies = {};
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index === -1) return;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  });
  return cookies;
}

const sessions = new Map(); // token -> momento en que expira

function createSession() {
  const token = crypto.randomBytes(32).toString('hex'); // 64 caracteres imposibles de adivinar
  sessions.set(token, Date.now() + SESSION_MAX_AGE_MS);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Comparación segura: se comparan los hashes, que siempre tienen el mismo largo
function pinMatches(candidate) {
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(PIN).digest();
  return crypto.timingSafeEqual(a, b);
}

const attempts = new Map(); // ip -> { count, lockedUntil }

// Middleware: deja pasar solo a quien tenga una sesión válida
function requirePage(req, res, next) {
  const { session } = parseCookies(req.headers.cookie);
  if (isValidSession(session)) return next();
  res.redirect('/login?next=' + encodeURIComponent(req.path));
}

// Igual que requirePage, pero para rutas de API: responde 401 en vez de redirigir
function requireApi(req, res, next) {
  const { session } = parseCookies(req.headers.cookie);
  if (isValidSession(session)) return next();
  res.status(401).json({ ok: false, error: 'Sesión vencida. Vuelve a ingresar el PIN.' });
}

// ---------- Archivos y rutas ----------
app.use(express.json({ limit: '1kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/music', express.static(MUSIC_DIR));

const viewPath = (name) => path.join(__dirname, 'views', name);

app.get('/audio', requirePage, (req, res) => {
  res.sendFile(viewPath('audio.html')); // ahora protegida: envía órdenes
});

app.get('/login', (req, res) => {
  res.sendFile(viewPath('login.html'));
});

app.get('/timer', requirePage, (req, res) => {
  res.sendFile(viewPath('timer.html'));
});

app.get('/mobile', requirePage, (req, res) => {
  res.sendFile(viewPath('mobile.html'));
});

app.get('/library', requirePage, (req, res) => {
  res.sendFile(viewPath('library.html'));
});

// Lista de categorías donde se puede subir música
app.get('/api/categories', requireApi, (req, res) => {
  res.json(CATEGORY_ORDER);
});

// Subir una canción: el navegador envía el archivo "crudo" como cuerpo de la petición
app.post('/api/upload', requireApi, async (req, res) => {
  const category = String(req.query.category || '');
  const name = path.basename(String(req.query.name || '')); // basename elimina cualquier "../"
  const ext = path.extname(name).toLowerCase();

  if (!CATEGORY_ORDER.includes(category)) {
    return res.status(400).json({ ok: false, error: 'Categoría no válida.' });
  }
  if (!name || !AUDIO_EXTENSIONS.includes(ext)) {
    return res.status(400).json({ ok: false, error: `Formato no permitido (${AUDIO_EXTENSIONS.join(' ')}).` });
  }

  const folder = path.join(MUSIC_DIR, category);
  const target = path.join(folder, name);
  const temp = target + '.part'; // se escribe aquí y recién al terminar se renombra

  fs.mkdirSync(folder, { recursive: true }); // si la carpeta no existe, se crea
  if (fs.existsSync(target)) {
    return res.status(409).json({ ok: false, error: 'Ya existe una canción con ese nombre.' });
  }

  try {
    await pipeline(req, limitBytes(MAX_UPLOAD_BYTES), fs.createWriteStream(temp));
    fs.renameSync(temp, target);
    broadcastLibrary();
    res.json({ ok: true });
  } catch (error) {
    fs.rmSync(temp, { force: true }); // borrar el archivo a medias
    if (!res.headersSent) {
      const tooLarge = error.message === 'too_large';
      res
        .status(tooLarge ? 413 : 500)
        .json({ ok: false, error: tooLarge ? 'El archivo es demasiado grande.' : 'No se pudo guardar el archivo.' });
    }
  }
});

// Borrar una canción
app.delete('/api/track', requireApi, (req, res) => {
  const category = String(req.query.category || '');
  const name = path.basename(String(req.query.name || ''));
  const ext = path.extname(name).toLowerCase();

  if (!CATEGORY_ORDER.includes(category) || !AUDIO_EXTENSIONS.includes(ext)) {
    return res.status(400).json({ ok: false, error: 'Solicitud no válida.' });
  }

  const target = path.join(MUSIC_DIR, category, name);
  if (!fs.existsSync(target)) {
    return res.status(404).json({ ok: false, error: 'La canción no existe.' });
  }

  fs.unlinkSync(target);
  broadcastLibrary();
  res.json({ ok: true });
});

app.post('/login', (req, res) => {
  const ip = req.ip;
  const record = attempts.get(ip) || { count: 0, lockedUntil: 0 };

  // ¿Este dispositivo está bloqueado?
  if (Date.now() < record.lockedUntil) {
    const seconds = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ ok: false, error: 'locked', retryAfterSeconds: seconds });
  }

  const pin = req.body && req.body.pin;

  if (typeof pin === 'string' && pinMatches(pin)) {
    attempts.delete(ip);
    const token = createSession();
    res.cookie('session', token, {
      httpOnly: true,            // el JavaScript de la página no puede leer la cookie
      sameSite: 'strict',        // otros sitios web no pueden usar tu sesión
      maxAge: SESSION_MAX_AGE_MS,
    });
    return res.json({ ok: true });
  }

  // PIN incorrecto: contar el intento y bloquear si llegó al límite
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
    record.count = 0;
  }
  attempts.set(ip, record);
  res.status(401).json({ ok: false, error: 'invalid' });
});

// Orden de los botones en el celular. Los nombres deben coincidir con las carpetas de music/
// (si tu carpeta se llama "Atmosfera" sin tilde, cámbialo aquí también).
// Las carpetas que no estén en la lista aparecen después, en orden alfabético.
// Orden de los botones. Los nombres son también los de las carpetas dentro de music/.
// Primera fila: música de fondo. Segunda fila: audio del servicio.
// (Si prefieres "Ofrenda" en vez de "Avisos", cámbialo aquí y nada más.)
const CATEGORY_ORDER = ['Piano', 'Pad', 'Atmósfera', 'Alabanzas', 'Avisos', 'Niños'];

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // máximo por canción: 500 MB

function sortCategories(names) {
  return names.sort((a, b) => {
    // normalize('NFC') evita diferencias de codificación de las tildes entre sistemas
    const posA = CATEGORY_ORDER.indexOf(a.normalize('NFC'));
    const posB = CATEGORY_ORDER.indexOf(b.normalize('NFC'));
    if (posA !== -1 && posB !== -1) return posA - posB;
    if (posA !== -1) return -1; // a está en la lista y b no: a va primero
    if (posB !== -1) return 1;
    return a.localeCompare(b);
  });
}

function getLibrary() {
  const library = {};
  if (!fs.existsSync(MUSIC_DIR)) return library;

  const folders = fs
    .readdirSync(MUSIC_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const name of sortCategories(folders)) {
    const files = fs
      .readdirSync(path.join(MUSIC_DIR, name))
      .filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (files.length > 0) library[name] = files;
  }
  return library;
}

// Avisa a todas las pantallas que la lista de canciones cambió
function broadcastLibrary() {
  io.emit('library:data', getLibrary());
}

// Corta la subida si el archivo supera el máximo, sin importar lo que diga el navegador
function limitBytes(max) {
  let seen = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      seen += chunk.length;
      if (seen > max) return callback(new Error('too_large'));
      callback(null, chunk);
    },
  });
}

// Ejecuta un comando y devuelve una promesa (para poder usar await)
function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => (error ? reject(error) : resolve()));
  });
}

const audioState = {
  category: null,
  playing: false,
  volume: 0.5,
  skipCount: 0,      // aumenta con cada « o »: cada aumento significa "cambia de pista"
  skipDirection: 1,  // 1 = siguiente (»), -1 = anterior («)
  playMode: 'continuous', // continuous, repeat o random
};

let shuttingDown = false;

// ---------- Estado del timer ----------
const timerState = {
  running: false,
  initialMs: 10 * 60 * 1000,
  remainingMs: 10 * 60 * 1000,
  endTime: null,
  finished: false,
  overtimeStart: null, // NUEVO: momento en que llegó a 0 por primera vez (null = no hay exceso)
};

function getRemainingMs() {
  if (timerState.running) return Math.max(0, timerState.endTime - Date.now());
  return timerState.remainingMs;
}

function getTimerPayload() {
  return {
    running: timerState.running,
    remainingMs: getRemainingMs(),
    initialMs: timerState.initialMs,
    finished: timerState.finished,
    // NUEVO: cuánto tiempo lleva excedido (o null si no hay exceso)
    overtimeMs:
      timerState.overtimeStart === null
        ? null
        : Math.max(0, Date.now() - timerState.overtimeStart),
  };
}

function broadcastTimer() {
  io.emit('timer:state', getTimerPayload());
}

setInterval(() => {
  // CAMBIO: también hay que seguir avisando mientras cuenta el tiempo excedido
  if (!timerState.running && timerState.overtimeStart === null) return;

  if (timerState.running && getRemainingMs() <= 0) {
    // NUEVO: el exceso empieza en el instante exacto en que llegó a 0,
    // y solo la primera vez (si ya había exceso, no se toca)
    if (timerState.overtimeStart === null) {
      timerState.overtimeStart = timerState.endTime;
    }
    timerState.running = false;
    timerState.remainingMs = 0;
    timerState.endTime = null;
    timerState.finished = true;
  }
  broadcastTimer();
}, 250);

// ---------- Batería del servidor (solo Linux; en otros sistemas queda en null) ----------
const POWER_DIR = '/sys/class/power_supply';

function readBattery() {
  try {
    const name = fs.readdirSync(POWER_DIR).find((entry) => entry.startsWith('BAT'));
    if (!name) return null;

    const read = (file) => fs.readFileSync(path.join(POWER_DIR, name, file), 'utf8').trim();
    const percent = Number(read('capacity'));
    if (Number.isNaN(percent)) return null;

    // status: Charging, Discharging, Full, Not charging o Unknown
    return { percent, status: read('status') };
  } catch (error) {
    return null; // sin batería o no se pudo leer
  }
}

let powerState = readBattery();

// Cada 10 segundos revisa, y avisa a todos solo si algo cambió
setInterval(() => {
  const current = readBattery();
  if (JSON.stringify(current) !== JSON.stringify(powerState)) {
    powerState = current;
    io.emit('power:state', powerState);
  }
}, 10 * 1000);

// ---------- Tiempo real ----------
io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

    // ----- Seguridad: nada se ejecuta sin una sesión válida -----
  const { session: token } = parseCookies(socket.handshake.headers.cookie);

  socket.use((packet, next) => {
    if (!isValidSession(token)) {
      socket.emit('auth:denied'); // avisar al cliente...
      return;                     // ...y descartar la orden sin ejecutarla
    }
    next();
  });

  // Al conectarse, cada cliente recibe la biblioteca y el estado actual
  socket.emit('library:data', getLibrary());
  socket.emit('audio:state', audioState);
  socket.emit('power:state', powerState);

  socket.on('audio:setCategory', (category) => {
    const library = getLibrary();
    if (!library[category]) return; // ignorar categorías que no existen
    audioState.category = category;
    audioState.playing = true;
    io.emit('audio:state', audioState);
  });

  socket.on('audio:toggle', () => {
    if (!audioState.category) return; // nada que pausar si no hay categoría
    audioState.playing = !audioState.playing;
    io.emit('audio:state', audioState);
  });

  socket.on('audio:next', () => {
    if (!audioState.category) return;
    audioState.skipCount += 1;
    audioState.skipDirection = 1;
    audioState.playing = true;
    io.emit('audio:state', audioState);
  });

  socket.on('audio:prev', () => {
    if (!audioState.category) return;
    audioState.skipCount += 1;
    audioState.skipDirection = -1;
    audioState.playing = true;
    io.emit('audio:state', audioState);
  });

  function toggleAudioMode() {
    const modes = ['continuous', 'repeat', 'random'];
    audioState.playMode = modes[(modes.indexOf(audioState.playMode) + 1) % modes.length];
    io.emit('audio:state', audioState);
  }

  socket.on('audio:toggleMode', toggleAudioMode);
  socket.on('audio:toggleRepeat', toggleAudioMode); // Compatibilidad con clientes anteriores

  socket.on('audio:volumeDelta', (delta) => {
    if (typeof delta !== 'number') return;
    const newVolume = audioState.volume + delta;
    audioState.volume = Math.min(1, Math.max(0, Math.round(newVolume * 100) / 100));
    io.emit('audio:state', audioState);
  });

    socket.on('system:shutdown', async () => {
    if (shuttingDown) return;

    // Protección: en Windows (tu PC de desarrollo) esto nunca debe apagar nada
    if (process.platform !== 'linux') {
      socket.emit('system:shutdown-failed', 'El apagado solo funciona en el servidor Linux.');
      return;
    }

    // Primero comprobar que tenemos permiso; si no, avisar sin hacer nada
    try {
      await run('sudo', ['-n', '-l', '/usr/bin/systemctl', 'poweroff']);
    } catch (error) {
      socket.emit('system:shutdown-failed', 'El servidor no tiene permiso para apagarse (falta la regla sudoers).');
      return;
    }

    shuttingDown = true;
    console.log('Apagado solicitado desde la web');
    io.emit('system:shutting-down'); // las pantallas muestran el aviso y detienen el audio

    // Esperar un momento para que el aviso llegue a todos antes de apagar
    setTimeout(() => {
      run('sudo', ['-n', '/usr/bin/systemctl', 'poweroff']).catch((error) => {
        shuttingDown = false;
        console.error('Falló el apagado:', error.message);
        io.emit('system:shutdown-failed', 'No se pudo apagar el servidor.');
      });
    }, 2000);
  });

    // ----- Timer -----
  socket.emit('timer:state', getTimerPayload());

  socket.on('timer:set', (minutes) => {
    if (typeof minutes !== 'number' || !isFinite(minutes) || minutes <= 0 || minutes > 600) return;
    const ms = Math.round(minutes * 60 * 1000);
    timerState.initialMs = ms;
    timerState.remainingMs = ms;
    timerState.running = false;
    timerState.endTime = null;
    timerState.finished = false;
    timerState.overtimeStart = null; // NUEVO: elegir una duración borra el exceso
    broadcastTimer();
  });

  socket.on('timer:start', () => {
    if (timerState.running || timerState.remainingMs <= 0) return;
    timerState.endTime = Date.now() + timerState.remainingMs;
    timerState.running = true;
    timerState.finished = false;
    broadcastTimer();
  });

  socket.on('timer:pause', () => {
    if (!timerState.running) return;
    timerState.remainingMs = getRemainingMs();
    timerState.running = false;
    timerState.endTime = null;
    broadcastTimer();
  });

  socket.on('timer:reset', () => {
    timerState.remainingMs = timerState.initialMs;
    timerState.running = false;
    timerState.endTime = null;
    timerState.finished = false;
    timerState.overtimeStart = null; // NUEVO: reiniciar es la única forma de borrar el exceso
    broadcastTimer();
  });

  socket.on('timer:adjust', (seconds) => {
    if (typeof seconds !== 'number' || !isFinite(seconds) || Math.abs(seconds) > 3600) return;
    const deltaMs = Math.round(seconds * 1000);

    if (timerState.running) {
      // Corriendo: mover el momento de término (nunca antes de "ahora")
      timerState.endTime = Math.max(Date.now(), timerState.endTime + deltaMs);
    } else if (timerState.finished) {
      // NUEVO: terminó y está en 00:00. Solo tiene sentido añadir tiempo,
      // y la cuenta regresiva se reanuda sola. El exceso sigue corriendo.
      if (deltaMs <= 0) return;
      timerState.remainingMs = deltaMs;
      timerState.endTime = Date.now() + deltaMs;
      timerState.running = true;
      timerState.finished = false;
    } else {
      // Pausado: ajustar el tiempo restante (nunca menos de 0)
      timerState.remainingMs = Math.max(0, timerState.remainingMs + deltaMs);
    }
    broadcastTimer();
  });

  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
  });
});

// ---------- Inicio ----------
server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log(' Church Control en marcha');
  console.log('==================================================');

  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`\n Red "${name}" (${net.address}):`);
        console.log(`   Celular del pastor : http://${net.address}:${PORT}/mobile`);
        console.log(`   Pantalla del timer (laptop) : http://${net.address}:${PORT}/timer`);
        console.log(`   Audio (laptop)     : http://${net.address}:${PORT}/audio`);
      }
    }
  }
  console.log('\n Para detener el servidor: Ctrl + C');
});