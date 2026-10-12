// Muestra el estado de la batería del servidor. power = { percent, status } o null
function renderPower(el, power) {
  if (!power) {
    el.hidden = true;
    return;
  }

  const onBattery = power.status === 'Discharging'; // se cortó la corriente
  const low = onBattery && power.percent <= 20;

  if (onBattery) {
    el.textContent = low
      ? `⚠️ Batería baja del servidor: ${power.percent}%`
      : `🔋 Servidor sin corriente: ${power.percent}%`;
  } else if (power.status === 'Charging') {
    el.textContent = `⚡ Servidor: ${power.percent}% · cargando`;
  } else {
    el.textContent = `🔌 Servidor: ${power.percent}% · con corriente`;
  }

  el.classList.toggle('warn', onBattery && !low);
  el.classList.toggle('danger', low);
  el.hidden = false;
}