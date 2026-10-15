const socket = io();

// ----- Elementos de la página -----
const player = document.getElementById('player');
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('btn-start');
const statusTextEl = document.getElementById('status-text');
const powerEl = document.getElementById('power');
const shutdownBtn = document.getElementById('btn-shutdown');
const shutdownMsgEl = document.getElementById('shutdown-msg');
const shutdownOverlay = document.getElementById('shutdown-overlay');
const titleEl = document.getElementById('track-title');
const nextEl = document.getElementById('track-next');
const seekEl = document.getElementById('seek');
const timeCurrentEl = document.getElementById('time-current');
const timeTotalEl = document.getElementById('time-total');
const backBtn = document.getElementById('btn-back');
const forwardBtn = document.getElementById('btn-forward');
const toggleBtn = document.getElementById('btn-toggle');
const nextBtn = document.getElementById('btn-next');
const volumeValueEl = document.getElementById('volume-value');
const volumeFillEl = document.getElementById('volume-fill');
const libraryEl = document.getElementById('library');
const prevBtn = document.getElementById('btn-prev');
const repeatBtn = document.getElementById('btn-repeat');

// ----- Estado -----
let library = {};                                       // { categoría: [archivos] }
let state = { category: null, playing: false, volume: 0.5, skipCount: 0, skipDirection: 1, playMode: 'continuous' };
let currentCategory = null;   // categoría cargada en el reproductor
let playlist = [];            // pistas de esa categoría (y solo de esa categoría)
let trackIndex = 0;           // posición actual dentro de la lista
let unlocked = false;         // ¿ya se hizo el clic inicial?
let lastSkipCount = 0;        // último valor de skipCount que ya procesamos
let dragging = false;         // ¿el usuario está arrastrando el slider?
let libraryRefs = {};         // referencias a los elementos de cada categoría

// ----- Utilidades -----
function trackName(file) {
  return file.replace(/\.[^.]+$/, ''); // quita la extensión: "tema.mp3" -> "tema"
}

function formatClock(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

// ----- Reproducción -----
function loadTrack() {
  const file = playlist[trackIndex];
  player.src = `/music/${encodeURIComponent(currentCategory)}/${encodeURIComponent(file)}`;
  player.loop = state.playMode === 'repeat' || playlist.length === 1;
  updateNowPlaying();
  updateLibrary();
}

function changeTrack(direction) {
  if (playlist.length < 2) return;

  if (state.playMode === 'random') {
    const randomIndex = Math.floor(Math.random() * (playlist.length - 1));
    trackIndex = randomIndex >= trackIndex ? randomIndex + 1 : randomIndex;
  } else {
    trackIndex = (trackIndex + direction + playlist.length) % playlist.length;
  }
  loadTrack();
}

function seekBy(seconds) {
  const duration = player.duration;
  if (!isFinite(duration)) return;
  player.currentTime = Math.min(duration, Math.max(0, player.currentTime + seconds));
}

// Al terminar una pista, pasar a la siguiente DE LA MISMA CATEGORÍA
player.addEventListener('ended', () => {
  changeTrack(1);
  if (state.playing) player.play().catch((err) => console.error('No se pudo reproducir:', err));
});

// ----- Pantalla: título, slider y tiempos -----
function updateNowPlaying() {
  const hasTrack = unlocked && currentCategory !== null && playlist.length > 0;
  seekEl.disabled = !hasTrack;
  backBtn.disabled = !hasTrack;
  forwardBtn.disabled = !hasTrack;

  if (!hasTrack) {
    titleEl.textContent = 'Sin música';
    nextEl.textContent = '';
    return;
  }

  titleEl.textContent = trackName(playlist[trackIndex]);
  if (playlist.length === 1) {
    nextEl.textContent = 'Una sola pista: se repite en loop';
  } else if (state.playMode === 'repeat') {
    nextEl.textContent = 'Esta pista se repite en bucle';
  } else if (state.playMode === 'random') {
    nextEl.textContent = 'La siguiente pista será aleatoria';
  } else {
    nextEl.textContent = 'Sigue: ' + trackName(playlist[(trackIndex + 1) % playlist.length]);
  }
}

function setProgressStyle(ratio) {
  seekEl.style.setProperty('--progress', ratio * 100 + '%');
}

function updateProgress() {
  const duration = player.duration;
  const hasDuration = isFinite(duration) && duration > 0;
  const ratio = hasDuration ? player.currentTime / duration : 0;

  if (!dragging) {
    seekEl.value = Math.round(ratio * 1000);
    setProgressStyle(ratio);
  }
  timeCurrentEl.textContent = formatClock(player.currentTime);
  timeTotalEl.textContent = formatClock(hasDuration ? duration : 0);
}

player.addEventListener('timeupdate', updateProgress);
player.addEventListener('loadedmetadata', updateProgress);

// Arrastrar el slider = saltar a esa posición
seekEl.addEventListener('pointerdown', () => { dragging = true; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointercancel', () => { dragging = false; });

seekEl.addEventListener('input', () => {
  const duration = player.duration;
  if (!isFinite(duration) || duration <= 0) return;
  player.currentTime = (seekEl.value / 1000) * duration;
  setProgressStyle(seekEl.value / 1000);
  timeCurrentEl.textContent = formatClock(player.currentTime);
});

// ----- Biblioteca: recuadros de categorías con casillas numeradas -----
function buildLibrary() {
  libraryEl.innerHTML = '';
  libraryRefs = {};

  const names = Object.keys(library);
  if (names.length === 0) {
    const message = document.createElement('p');
    message.className = 'empty muted';
    message.textContent = 'No hay categorías. Agrega carpetas con música dentro de music/.';
    libraryEl.appendChild(message);
    return;
  }

  for (const name of names) {
    const column = document.createElement('div');
    column.className = 'lib-col';

    const btn = document.createElement('button');
    btn.className = 'btn category';
    btn.textContent = name;
    btn.addEventListener('click', () => socket.emit('audio:setCategory', name));

    const summary = document.createElement('div');
    summary.className = 'lib-summary muted';

    const chipsEl = document.createElement('div');
    chipsEl.className = 'chips';

    const chips = library[name].map((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = index + 1;
      chip.title = trackName(file); // al pasar el mouse por encima, muestra el nombre
      chipsEl.appendChild(chip);
      return chip;
    });

    column.append(btn, summary, chipsEl);
    libraryEl.appendChild(column);
    libraryRefs[name] = { btn, summary, chips };
  }

  updateLibrary();
}

// Solo actualiza clases y textos: no vuelve a crear los botones
function updateLibrary() {
  for (const [name, refs] of Object.entries(libraryRefs)) {
    const total = refs.chips.length;
    const isActive = name === state.category;
    const loaded = isActive && name === currentCategory; // ¿ya está cargada en el reproductor?

    refs.btn.classList.toggle('active', isActive);

    refs.chips.forEach((chip, index) => {
      chip.classList.toggle('current', loaded && index === trackIndex);
      chip.classList.toggle('played', loaded && state.playMode !== 'random' && index < trackIndex);
      chip.classList.toggle('next', loaded && state.playMode === 'continuous' && total > 1 && index === (trackIndex + 1) % total);
    });

    refs.summary.textContent = loaded
      ? state.playMode === 'random'
        ? `Pista ${trackIndex + 1} de ${total} · modo aleatorio`
        : `Pista ${trackIndex + 1} de ${total} · quedan ${total - trackIndex - 1}`
      : `${total} ${total === 1 ? 'pista' : 'pistas'}`;
  }
}

// ----- Aplicar el estado que informa el servidor -----
function applyState() {
  player.volume = state.volume;
  const percent = Math.round(state.volume * 100);
  volumeValueEl.textContent = percent + '%';
  volumeFillEl.style.width = percent + '%';

  toggleBtn.textContent = state.playing ? '⏸ Pausar' : '▶ Reproducir';
  toggleBtn.disabled = !state.category;
  nextBtn.disabled = !state.category;
  prevBtn.disabled = !state.category;

  const modeLabels = {
    continuous: { icon: '⏭', title: 'Modo actual: reproducción continua (clic para repetir esta pista)' },
    repeat: { icon: '🔂', title: 'Modo actual: repetir esta pista (clic para reproducción aleatoria)' },
    random: { icon: '🔀', title: 'Modo actual: reproducción aleatoria (clic para reproducción continua)' },
  };
  const mode = modeLabels[state.playMode] || modeLabels.continuous;
  repeatBtn.textContent = mode.icon;
  repeatBtn.classList.toggle('active', state.playMode !== 'continuous');
  repeatBtn.title = mode.title;

  if (unlocked && state.category) {
    if (state.category !== currentCategory) {
      // Categoría nueva: cargar solo sus pistas, desde la primera
      currentCategory = state.category;
      lastSkipCount = state.skipCount;
      playlist = library[currentCategory] || [];
      trackIndex = 0;
      if (playlist.length > 0) loadTrack();
    } else if (state.skipCount !== lastSkipCount) {
      // « o »: cambiar de pista dentro de la misma categoría, dando la vuelta en los extremos
      lastSkipCount = state.skipCount;
      if (playlist.length > 1) {
        changeTrack(state.skipDirection);
      }
    }

    // El modo bucle puede cambiar con la pista ya sonando
    player.loop = state.playMode === 'repeat' || playlist.length === 1;

    if (playlist.length > 0) {
      if (state.playing) {
        player.play().catch((err) => console.error('No se pudo reproducir:', err));
      } else {
        player.pause();
      }
    }
  }

  updateNowPlaying();
  updateLibrary();
}

// ----- Clic inicial -----
startBtn.addEventListener('click', () => {
  unlocked = true;
  startOverlay.remove();
  applyState();
});

// ----- Conexión y mensajes del servidor -----
socket.on('connect', () => {
  statusTextEl.textContent = 'Conectado';
  document.body.classList.remove('offline');
});

socket.on('disconnect', () => {
  statusTextEl.textContent = 'Sin conexión';
  document.body.classList.add('offline');
});

socket.on('library:data', (data) => {
  const playingFile = currentCategory ? playlist[trackIndex] : null;
  library = data;

  if (currentCategory && library[currentCategory]) {
    playlist = library[currentCategory];
    const newIndex = playlist.indexOf(playingFile);
    trackIndex = newIndex !== -1 ? newIndex : Math.min(trackIndex, playlist.length - 1);
  }

  buildLibrary();
  updateNowPlaying();
});

socket.on('audio:state', (newState) => {
  state = newState;
  applyState();
});

// ----- Botones: todos envían órdenes al servidor, igual que el celular -----
toggleBtn.addEventListener('click', () => socket.emit('audio:toggle'));
nextBtn.addEventListener('click', () => socket.emit('audio:next'));
prevBtn.addEventListener('click', () => socket.emit('audio:prev'));
repeatBtn.addEventListener('click', () => socket.emit('audio:toggleMode'));

document.getElementById('btn-vol-down').addEventListener('click', () => {
  socket.emit('audio:volumeDelta', -0.05);
});
document.getElementById('btn-vol-up').addEventListener('click', () => {
  socket.emit('audio:volumeDelta', 0.05);
});

// ----- Botones locales: la posición dentro de la pista solo existe en esta computadora -----
backBtn.addEventListener('click', () => seekBy(-10));
forwardBtn.addEventListener('click', () => seekBy(10));

// ----- Sesión vencida: volver al login -----
socket.on('auth:denied', () => {
  window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
});

updateNowPlaying();

// ----- Batería del servidor -----
socket.on('power:state', (power) => renderPower(powerEl, power));

// ----- Apagado del servidor (doble toque) -----
let shutdownArmed = false;
let shutdownTimer = null;

function disarmShutdown() {
  shutdownArmed = false;
  clearInterval(shutdownTimer);
  shutdownBtn.classList.remove('armed');
  shutdownBtn.textContent = '⏻ Apagar servidor';
}

shutdownBtn.addEventListener('click', () => {
  if (!shutdownArmed) {
    shutdownArmed = true;
    let seconds = 5;
    shutdownBtn.classList.add('armed');
    shutdownBtn.textContent = `¿Seguro? Toca otra vez para apagar (${seconds})`;
    shutdownTimer = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        disarmShutdown();
      } else {
        shutdownBtn.textContent = `¿Seguro? Toca otra vez para apagar (${seconds})`;
      }
    }, 1000);
    return;
  }

  disarmShutdown();
  shutdownMsgEl.textContent = '';
  socket.emit('system:shutdown');
});

// El servidor confirmó que se apaga: detener el audio y mostrar el aviso
socket.on('system:shutting-down', () => {
  player.pause();
  shutdownOverlay.hidden = false;
});

// No se pudo apagar: volver a la normalidad y explicar por qué
socket.on('system:shutdown-failed', (message) => {
  shutdownOverlay.hidden = true;
  shutdownMsgEl.textContent = message;
  applyState(); // retoma la música si estaba sonando
  setTimeout(() => { shutdownMsgEl.textContent = ''; }, 10000);
});