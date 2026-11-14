# /etc/nginx/sites-available/bot.coopscollection.com on the production VPS,
# as it runs after `certbot --nginx -d bot.coopscollection.com --redirect`.
# The "managed by Certbot" lines are certbot's: keep them when editing. On a
# fresh server, leave them out (and the second server block), then run certbot.
#
# Dashboard delivery (2026-11 dashboard UX audit):
#   - gzip for scripts, styles and JSON. nginx.conf has `gzip on` but only
#     compresses text/html by default; pokemonData.json goes 369 KB -> 73 KB.
#   - HTTP/2, so a page's modules and sprites share one connection instead
#     of queueing on six HTTP/1.1 ones. `http2 on` needs nginx 1.25.1+
#     (the VPS runs 1.28).
# Apply: copy over the live file, `sudo nginx -t`, then `sudo systemctl reload nginx`.
server {
    server_name bot.coopscollection.com;

    client_max_body_size 1m;

    http2 on;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/css application/javascript text/javascript application/json image/svg+xml text/plain;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    listen [::]:443 ssl; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/bot.coopscollection.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/bot.coopscollection.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    if ($host = bot.coopscollection.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    listen [::]:80;
    server_name bot.coopscollection.com;
    return 404; # managed by Certbot
}
