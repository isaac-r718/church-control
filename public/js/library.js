const socket = io();

const statusTextEl = document.getElementById('status-text');
const categorySelect = document.getElementById('category');
const dropzone = document.getElementById('dropzone');
const pickBtn = document.getElementById('btn-pick');
const fileInput = document.getElementById('file-input');
const uploadsEl = document.getElementById('uploads');
const tracksEl = document.getElementById('tracks');

// Misma lista que el servidor (el servidor la vuelve a comprobar)
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.opus', '.aac', '.flac', '.webm'];

let categories = [];
let library = {};

function goToLogin() {
  window.location.href = '/login?next=/library';
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

// La lista de canciones se actualiza sola cuando alguien sube o borra
socket.on('library:data', (data) => {
  library = data;
  renderTracks();
});

// ----- Categorías -----
async function loadCategories() {
  const response = await fetch('/api/categories');
  if (response.status === 401) return goToLogin();

  categories = await response.json();
  categorySelect.innerHTML = '';
  for (const name of categories) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    categorySelect.appendChild(option);
  }
  renderTracks();
}

// ----- Lista de canciones con botón de borrar (doble toque) -----
function renderTracks() {
  tracksEl.innerHTML = '';

  for (const category of categories) {
    const files = library[category] || [];

    const group = document.createElement('div');
    group.className = 'track-group';

    const title = document.createElement('h3');
    title.textContent = `${category} · ${files.length} ${files.length === 1 ? 'pista' : 'pistas'}`;
    group.appendChild(title);

    if (files.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Sin canciones';
      group.appendChild(empty);
    }

    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'track-row';

      const label = document.createElement('span');
      label.className = 'track-name';
      label.textContent = `${index + 1}. ${file}`;
      label.title = file;

      const del = document.createElement('button');
      del.className = 'btn btn-danger btn-small';
      del.textContent = 'Borrar';

      let armed = false;
      del.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          del.textContent = '¿Seguro?';
          del.classList.add('armed');
          setTimeout(() => {
            armed = false;
            del.textContent = 'Borrar';
            del.classList.remove('armed');
          }, 3000);
          return;
        }
        deleteTrack(category, file);
      });

      row.append(label, del);
      group.appendChild(row);
    });

    tracksEl.appendChild(group);
  }
}

async function deleteTrack(category, file) {
  const url = `/api/track?category=${encodeURIComponent(category)}&name=${encodeURIComponent(file)}`;
  const response = await fetch(url, { method: 'DELETE' });
  if (response.status === 401) return goToLogin();

  const data = await response.json();
  if (!data.ok) alert(data.error);
}

// ----- Subir canciones -----
function createUploadItem(name, category) {
  const li = document.createElement('li');
  li.className = 'upload-item';

  const label = document.createElement('div');
  label.className = 'upload-label';
  label.textContent = `${name} → ${category}`;

  const bar = document.createElement('div');
  bar.className = 'upload-bar';
  const fill = document.createElement('div');
  fill.className = 'upload-fill';
  bar.appendChild(fill);

  const message = document.createElement('div');
  message.className = 'upload-msg muted';
  message.textContent = 'En espera...';

  li.append(label, bar, message);
  uploadsEl.appendChild(li);

  return {
    setProgress(ratio) {
      const percent = Math.round(ratio * 100);
      fill.style.width = percent + '%';
      message.textContent = percent + '%';
    },
    setDone() {
      fill.style.width = '100%';
      li.classList.add('done');
      message.textContent = '✔ Subida';
    },
    setError(text) {
      li.classList.add('error');
      fill.style.width = '100%';
      message.textContent = '✖ ' + text;
    },
  };
}

// Se usa XMLHttpRequest (y no fetch) porque permite medir el progreso de subida
function uploadFile(file, category) {
  return new Promise((resolve) => {
    const item = createUploadItem(file.name, category);

    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(extension)) {
      item.setError('Formato no permitido');
      return resolve();
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?category=${encodeURIComponent(category)}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) item.setProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status === 401) return goToLogin();

      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (error) { /* respuesta sin JSON */ }

      if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
        item.setDone();
      } else {
        item.setError(data.error || `Error ${xhr.status}`);
      }
      resolve();
    };

    xhr.onerror = () => {
      item.setError('Falló la conexión');
      resolve();
    };

    xhr.send(file); // el archivo viaja tal cual como cuerpo de la petición
  });
}

async function uploadAll(files) {
  const category = categorySelect.value; // se fija al empezar
  for (const file of files) {
    await uploadFile(file, category); // de a una, para no saturar la red
  }
}

pickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const files = [...fileInput.files]; // copiar antes de limpiar el selector
  fileInput.value = '';
  uploadAll(files);
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('over');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('over');
  uploadAll([...event.dataTransfer.files]);
});

loadCategories();