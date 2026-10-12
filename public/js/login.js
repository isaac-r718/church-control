const form = document.getElementById('login-form');
const pinInput = document.getElementById('pin');
const messageEl = document.getElementById('message');

// A dónde volver después de entrar. Solo se aceptan destinos conocidos.
const allowedDestinations = ['/mobile', '/timer', '/audio', '/library'];
const requested = new URLSearchParams(window.location.search).get('next');
const destination = allowedDestinations.includes(requested) ? requested : '/mobile';

form.addEventListener('submit', async (event) => {
  event.preventDefault(); // evita que el formulario recargue la página
  messageEl.textContent = '';

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinInput.value }),
    });
    const data = await response.json();

    if (response.ok) {
      window.location.href = destination;
    } else if (response.status === 429) {
      messageEl.textContent = `Demasiados intentos. Espera ${data.retryAfterSeconds} segundos.`;
    } else {
      messageEl.textContent = 'PIN incorrecto.';
    }
  } catch (error) {
    messageEl.textContent = 'No se pudo conectar con el servidor.';
  }

  pinInput.value = '';
});