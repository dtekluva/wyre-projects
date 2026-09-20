# Deploy hook

GitHub Actions (`.github/workflows/ci.yml`) runs the tests. Only when they pass, and only for a push to
`main`, it POSTs `{sha, ref}` to `https://tracker.wyreng.com/hooks/deploy`, HMAC-SHA256-signed with the
repository secret `DEPLOY_HOOK_SECRET`. `hook.py` on the box verifies the signature, checks the ref, and
runs `deploy.sh <sha>` — fetch, hard-reset to that commit, build, restart, health-check, roll back on
failure. Actions then polls `/hooks/deploy/status` and goes red if the box rolled back.

## Install (once, on the box, as root)

```
cd /opt/wyre-tracker && git pull
umask 077 && printf 'DEPLOY_HOOK_SECRET=%s\n' "$(openssl rand -hex 32)" > /etc/wyre-deploy-hook.env
cp ops/deploy-hook/wyre-deploy-hook.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now wyre-deploy-hook
```

nginx, inside the 443 server block for tracker.wyreng.com:

```
location /hooks/ { proxy_pass http://127.0.0.1:9001; client_max_body_size 16k; proxy_read_timeout 15s; }
```

Then paste the value from `/etc/wyre-deploy-hook.env` into GitHub → repository Settings → Secrets and
variables → Actions → `DEPLOY_HOOK_SECRET`. Until that is set, the deploy job skips with a warning and
nothing reaches the box.

## Where things are

- log: `/var/log/wyre-deploy.log` (hook lines + full build output per deploy)
- last result: `/opt/wyre-tracker/.deployed` — also served as `/hooks/deploy/status`
- manual deploy of a specific commit: `ops/deploy-hook/deploy.sh <sha>`
- rotate the secret: change the env file, `systemctl restart wyre-deploy-hook`, update the GitHub secret
