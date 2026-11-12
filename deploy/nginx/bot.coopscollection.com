# /etc/nginx/sites-available/bot.coopscollection.com on the production VPS.
# This is the file as written before `certbot --nginx -d bot.coopscollection.com --redirect`,
# which added the 443 listener, certificate lines and the HTTP->HTTPS redirect.
server {
    listen 80;
    listen [::]:80;
    server_name bot.coopscollection.com;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
