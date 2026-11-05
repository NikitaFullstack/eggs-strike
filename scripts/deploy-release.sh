#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:?archive path required}
revision=${2:?revision required}
[[ $revision =~ ^[a-f0-9]{40}-[0-9]+$ ]] || { echo 'Invalid revision' >&2; exit 1; }
root=/opt/egg-strike
release="$root/releases/$revision"
previous=$(readlink -f "$root/current" 2>/dev/null || true)
mkdir -p "$release"
tar -xzf "$archive" -C "$release"
rm -f "$archive"
cd "$release"
npm ci --omit=dev
ln -sfn "$release" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
if ! sudo -n /usr/bin/systemctl restart egg-strike.service || ! curl --fail --silent --retry 10 --retry-delay 1 --retry-connrefused http://127.0.0.1:3000/ | grep -q 'ЯЙЦА — перестрелка' || ! systemctl is-active --quiet egg-strike.service; then
  echo 'Deployment failed; restoring previous release' >&2
  if [[ -n $previous && -d $previous ]]; then
    ln -sfn "$previous" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
    sudo -n /usr/bin/systemctl restart egg-strike.service || true
  else
    sudo -n /usr/bin/systemctl stop egg-strike.service || true
    rm -f "$root/current"
  fi
  exit 1
fi
echo "Deployed $revision"
