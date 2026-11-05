#!/usr/bin/env bash
# Run once as root on a fresh server, with the public deployment key as $1.
set -Eeuo pipefail
key_file=${1:?Usage: setup-deploy-server.sh /path/to/deploy-key.pub}
[[ $(id -u) == 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ -f $key_file ]] || { echo 'Public key not found' >&2; exit 1; }
if id eggdeploy >/dev/null 2>&1 || [[ -e /etc/systemd/system/egg-strike.service || -e /opt/egg-strike ]]; then
  echo 'An eggdeploy account or Egg Strike installation already exists; inspect it before continuing.' >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nodejs npm curl sudo
node -e 'if (+process.versions.node.split(".")[0] < 18) process.exit(1)'
useradd --create-home --shell /bin/bash eggdeploy
install -d -o eggdeploy -g eggdeploy -m 700 /home/eggdeploy/.ssh
printf 'restrict %s\n' "$(cat "$key_file")" > /home/eggdeploy/.ssh/authorized_keys
chown eggdeploy:eggdeploy /home/eggdeploy/.ssh/authorized_keys
chmod 600 /home/eggdeploy/.ssh/authorized_keys
install -d -o eggdeploy -g eggdeploy -m 755 /opt/egg-strike /opt/egg-strike/releases
cat > /etc/systemd/system/egg-strike.service <<'UNIT'
[Unit]
Description=Egg Strike game server
After=network.target
[Service]
Type=simple
User=nobody
Group=nogroup
WorkingDirectory=/opt/egg-strike/current
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/egg-strike/current/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
[Install]
WantedBy=multi-user.target
UNIT
printf '%s\n' 'eggdeploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart egg-strike.service, /usr/bin/systemctl stop egg-strike.service' > /etc/sudoers.d/egg-strike
chmod 440 /etc/sudoers.d/egg-strike
visudo -cf /etc/sudoers.d/egg-strike
systemctl daemon-reload
systemctl enable egg-strike.service
echo 'Ready for the first deployment on port 3000.'
