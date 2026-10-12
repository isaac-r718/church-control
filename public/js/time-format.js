function pad(n) {
  return String(n).padStart(2, '0');
}

// Tiempo restante: HH:MM:SS (redondea hacia arriba)
function formatHMS(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Tiempo excedido: +MM:SS, y +H:MM:SS pasada la primera hora (redondea hacia abajo)
function formatOvertime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `+${h}:${pad(m)}:${pad(s)}` : `+${pad(m)}:${pad(s)}`;
}