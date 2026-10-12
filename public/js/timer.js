const socket = io();

const displayEl = document.getElementById('display');
const overtimeEl = document.getElementById('overtime');
const toggleBtn = document.getElementById('btn-toggle');
const resetBtn = document.getElementById('btn-reset');
const statusEl = document.getElementById('status');

let state = { running: false, remainingMs: 0, initialMs: 0, finished: false, overtimeMs: null };

function render() {
  displayEl.textContent = formatHMS(state.remainingMs);
  displayEl.classList.toggle('finished', state.finished);
  toggleBtn.textContent = state.running ? 'Pausar' : 'Iniciar';

  if (state.overtimeMs === null) {
    overtimeEl.classList.remove('active');
  } else {
    overtimeEl.textContent = formatOvertime(state.overtimeMs);
    overtimeEl.classList.add('active');
  }
}

// ----- Mensajes del servidor -----
socket.on('timer:state', (newState) => {
  state = newState;
  render();
});

socket.on('connect', () => {
  statusEl.textContent = 'Conectado ✅';
  document.body.classList.remove('offline');
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Desconectado ❌';
  document.body.classList.add('offline');
});

// ----- Botones -----
toggleBtn.addEventListener('click', () => {
  socket.emit(state.running ? 'timer:pause' : 'timer:start');
});

resetBtn.addEventListener('click', () => socket.emit('timer:reset'));

document.querySelectorAll('.adjust').forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('timer:adjust', Number(btn.dataset.seconds));
  });
});

document.querySelectorAll('.preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('timer:set', Number(btn.dataset.minutes));
  });
});

socket.on('auth:denied', () => {
  window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
});