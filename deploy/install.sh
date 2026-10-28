#!/bin/sh
# Run as root on the target after copying this complete repository to /opt/satisfactory-webui.
set -eu
cd /opt/satisfactory-webui
id satisfactory >/dev/null
python3 -m unittest discover -s tests -v
/usr/sbin/visudo -cf deploy/satisfactory-webui.sudoers
install -m 0440 deploy/satisfactory-webui.sudoers /etc/sudoers.d/satisfactory-webui
install -m 0644 deploy/satisfactory-webui.service /etc/systemd/system/satisfactory-webui.service
chown -R root:root /opt/satisfactory-webui
chmod -R go-w /opt/satisfactory-webui
systemctl daemon-reload
systemctl enable --now satisfactory-webui.service
systemctl restart satisfactory-webui.service
systemctl is-active satisfactory-webui.service
