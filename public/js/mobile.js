const socket = io();

// ----- Elementos de la página -----
const statusTextEl = document.getElementById('status-text');
const nowLabelEl = document.getElementById('now-label');
const playStateEl = document.getElementById('play-state');
const toggleBtn = document.getElementById('btn-toggle');
const volumeValueEl = document.getElementById('volume-value');
const volumeFillEl = document.getElementById('volume-fill');
const categoriesEl = document.getElementById('categories');
const nextBtn = document.getElementById('btn-next');
const timerDisplayEl = document.getElementById('timer-display');
const timerOvertimeEl = document.getElementById('timer-overtime');
const timerStateEl = document.getElementById('timer-state');
const prevBtn = document.getElementById('btn-prev');
// Categorías que se muestran en el celular. Para mostrar más, agrega sus nombres aquí.
const PHONE_CATEGORIES = ['Piano', 'Pad', 'Atmósfera'];

let currentCategory = null; // categoría que informó el servidor

// Vibración corta al tocar un botón (funciona en Android; iPhone la ignora)
function tap() {
  if (navigator.vibrate) navigator.vibrate(20);
}

// ----- Conexión -----
socket.on('connect', () => {
  statusTextEl.textContent = 'Conectado';
  document.body.classList.remove('offline');
});

socket.on('disconnect', () => {
  statusTextEl.textContent = 'Sin conexión';
  document.body.classList.add('offline');
});

// ----- Música: botones de categorías -----
socket.on('library:data', (library) => {
  categoriesEl.innerHTML = '';
  const names = Object.keys(library).filter((name) => PHONE_CATEGORIES.includes(name));

  if (names.length === 0) {
    const message = document.createElement('p');
    message.className = 'empty muted';
    message.textContent = 'No hay categorías. Agrega carpetas con música dentro de music/.';
    categoriesEl.appendChild(message);
    return;
  }

  for (const name of names) {
    const btn = document.createElement('button');
    btn.className = 'btn category';
    btn.textContent = name;
    btn.dataset.category = name;
    btn.classList.toggle('active', name === currentCategory);
    btn.addEventListener('click', () => {
      tap();
      socket.emit('audio:setCategory', name);
    });
    categoriesEl.appendChild(btn);
  }
});

// ----- Música: estado real informado por el servidor -----
socket.on('audio:state', (state) => {
  currentCategory = state.category;

  nowLabelEl.textContent = state.category ?? 'Sin música';
  playStateEl.textContent = state.category ? (state.playing ? 'Sonando' : 'Pausada') : '';

  toggleBtn.textContent = state.playing ? '⏸ Pausar' : '▶ Reproducir';
  toggleBtn.disabled = !state.category;
  nextBtn.disabled = !state.category;
  prevBtn.disabled = !state.category;

  const percent = Math.round(state.volume * 100);
  volumeValueEl.textContent = percent + '%';
  volumeFillEl.style.width = percent + '%';

  document.querySelectorAll('.category').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.category === state.category);
  });
});

// ----- Música: botones -----
toggleBtn.addEventListener('click', () => {
  tap();
  socket.emit('audio:toggle');
});

document.getElementById('btn-vol-down').addEventListener('click', () => {
  tap();
  socket.emit('audio:volumeDelta', -0.05);
});

document.getElementById('btn-vol-up').addEventListener('click', () => {
  tap();
  socket.emit('audio:volumeDelta', 0.05);
});

nextBtn.addEventListener('click', () => {
  tap();
  socket.emit('audio:next');
});

prevBtn.addEventListener('click', () => {
  tap();
  socket.emit('audio:prev');
});

// ----- Timer: lectura -----
socket.on('timer:state', (timer) => {
  timerDisplayEl.textContent = formatHMS(timer.remainingMs);
  timerDisplayEl.classList.toggle('finished', timer.finished);

  if (timer.overtimeMs === null) {
    timerOvertimeEl.classList.remove('active');
  } else {
    timerOvertimeEl.textContent = formatOvertime(timer.overtimeMs);
    timerOvertimeEl.classList.add('active');
  }

  if (timer.finished) {
    timerStateEl.textContent = 'Terminó';
  } else if (timer.running) {
    timerStateEl.textContent = 'En marcha';
  } else {
    timerStateEl.textContent = 'Detenido';
  }
});

// ----- Timer: solo sumar o restar tiempo -----
document.querySelectorAll('.timer-adjust').forEach((btn) => {
  btn.addEventListener('click', () => {
    tap();
    socket.emit('timer:adjust', Number(btn.dataset.seconds));
  });
});

// ----- Sesión vencida: volver al login -----
socket.on('auth:denied', () => {
  window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
});