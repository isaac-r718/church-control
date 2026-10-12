# Despliegue en un servidor Linux (Debian 13, sin pantalla)

Cómo dejar Church Control corriendo en una laptop antigua, sin interfaz gráfica, que arranque sola y se pueda apagar desde la web. Los comandos usan el usuario `iglesia` y la carpeta `~/church-control`; cámbialos si usas otros.

## 1. Instalar Debian

- Descargar el *netinst* amd64 de https://www.debian.org/distrib/netinst y grabarlo en un pendrive (balenaEtcher, o Rufus en modo DD).
- En el instalador: hostname `church-server`, **contraseña de root vacía** (así el usuario queda con `sudo`), disco completo en una partición.
- En *Software selection* dejar marcados **solo** "SSH server" y "standard system utilities".

## 2. Preparar el sistema

```bash
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone America/Santiago
sudo apt install -y avahi-daemon curl ca-certificates
```

## 3. Node.js 24 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

## 4. Instalar la aplicación

```bash
sudo apt install -y git
git clone https://github.com/USUARIO/church-control.git ~/church-control
cd ~/church-control
cp config.example.json config.json && nano config.json   # poner un PIN de 4 a 8 dígitos
npm ci --omit=dev
node server.js                                           # prueba a mano (Ctrl+C para salir)
```

Si el repositorio es privado, se puede copiar desde otro computador con `scp -r server.js package.json package-lock.json config.json public views usuario@IP:~/church-control/`.

## 5. Servicio que arranca solo y se reinicia si falla

```bash
sudo cp deploy/church-control.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now church-control
systemctl status church-control --no-pager
```

## 6. Que cerrar la tapa no suspenda el equipo

```bash
sudo mkdir -p /etc/systemd/logind.conf.d
sudo cp deploy/logind-lid.conf /etc/systemd/logind.conf.d/lid.conf
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo reboot
```

## 7. Permiso para apagar desde la web

El servicio corre sin privilegios. Se le permite **un solo comando**, validando el archivo antes de instalarlo (un error en `sudoers` puede dejar `sudo` inutilizable):

```bash
sudo cp deploy/sudoers-poweroff.example /tmp/church-poweroff   # editar el usuario si no es "iglesia"
sudo visudo -cf /tmp/church-poweroff && sudo install -m 440 -o root -g root /tmp/church-poweroff /etc/sudoers.d/church-poweroff
sudo rm /tmp/church-poweroff
```

## 8. Red: Wi-Fi e IP fija con NetworkManager

```bash
sudo apt install -y network-manager wpasupplicant iw rfkill arp-scan tcpdump
sudo cp /etc/network/interfaces /etc/network/interfaces.bak
sudo tee /etc/network/interfaces > /dev/null <<'EOF'
source /etc/network/interfaces.d/*
auto lo
iface lo inet loopback
EOF
sudo reboot
```

Después del reinicio (`ip -br link` muestra el nombre de la interfaz Wi-Fi, por ejemplo `wlp3s0`):

```bash
sudo nmcli connection add type wifi ifname wlp3s0 con-name 'Iglesia' \
  ssid 'NOMBRE_DE_LA_RED' wifi-sec.key-mgmt wpa-psk wifi-sec.psk 'CLAVE' \
  connection.autoconnect yes connection.autoconnect-retries 0 \
  802-11-wireless.powersave 2 802-11-wireless.cloned-mac-address permanent
```

IP fija, de preferencia con una **reserva DHCP en el router** (la MAC sale de `ip -br link show wlp3s0`). Sin acceso al router, IP manual:

```bash
sudo nmcli connection modify 'Iglesia' ipv4.method manual \
  ipv4.addresses 192.168.1.200/24 ipv4.gateway 192.168.1.1 ipv4.dns 192.168.1.1
sudo nmcli connection up 'Iglesia'
```

## 9. Operación diaria

| Quiero... | Comando o lugar |
|---|---|
| Ver el registro | `journalctl -u church-control -f` |
| Reiniciar la app | `sudo systemctl restart church-control` (se pierden las sesiones de PIN) |
| Actualizar el código | `cd ~/church-control && git pull && npm ci --omit=dev && sudo systemctl restart church-control` |
| Subir o borrar música | `/library` desde cualquier navegador con sesión |
| Apagar | Botón **Apagar servidor** en `/audio` (doble toque) |

## 10. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Un celular no abre la página | Otra red Wi-Fi (invitados, repetidor) | Comparar las tres primeras partes de la IP del teléfono con la del servidor |
| Mismo caso, pero misma red | El teléfono manda el tráfico por datos móviles | Apagar los datos móviles y el cambio automático (Android) o la Asistencia de Wi-Fi (iPhone) |
| La página no abre en iPhone | Dirección incompleta | Escribir `http://IP:3000/mobile` completo, o usar un código QR |
| `church-server.local` no resuelve en Android | Android no resuelve bien mDNS | Usar la IP |
| Ningún teléfono, pero el PC sí | Aislamiento de clientes en el Wi-Fi | Probar con la red principal o desactivar el aislamiento en el router |
| ¿Llega el tráfico al servidor? | | `sudo tcpdump -n -i wlp3s0 'tcp port 3000'` mientras el teléfono intenta |
| Cable sin IP | Enchufe sin conexión al router o puerto sin DHCP | `ip -br link` (`NO-CARRIER` = sin enlace físico); usar Wi-Fi |